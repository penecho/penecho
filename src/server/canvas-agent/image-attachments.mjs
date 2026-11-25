import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import LocalAttachmentStore, { validateImageFile } from '@deepseek-ai/dsh-attachment-local'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { utimes, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagedFileRetention, attachmentRetention } from './managed-file-retention.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10])
const PNG_METADATA_CHUNKS = new Set(['iCCP','eXIf','tEXt','zTXt','iTXt'])
const WEBP_METADATA_CHUNKS = new Set(['ICCP','EXIF','XMP '])
const WEBP_METADATA_FLAGS = 0x20 | 0x08 | 0x04
const PNG_FALLBACK_VERSION = 'penecho-webp-png-request-v1'
const PNG_FALLBACK_CACHE_LIMIT = 64
export const PENECHO_ATTACHMENT_NORMALIZATION = Object.freeze({
  normalizedImageMaxDimension:2048,
  normalizedImageMaxPixels:4_194_304,
  normalizedImageMaxBytes:4_194_304,
})

function stripWebpMetadata(input) {
  const data=Buffer.from(input)
  if (data.length < 12 || data.toString('ascii',0,4) !== 'RIFF' || data.toString('ascii',8,12) !== 'WEBP' || data.readUInt32LE(4)+8 !== data.length) return data
  const chunks=[]
  let offset=12,changed=false
  while (offset < data.length) {
    if (offset+8 > data.length) return data
    const type=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),padded=length+(length&1),end=offset+8+padded
    if (end > data.length) return data
    if (WEBP_METADATA_CHUNKS.has(type)) changed=true
    else if (type === 'VP8X' && length >= 1) {
      const chunk=Buffer.from(data.subarray(offset,end)),flags=chunk[8],cleanFlags=flags&~WEBP_METADATA_FLAGS
      if (flags !== cleanFlags) { chunk[8]=cleanFlags;changed=true }
      chunks.push(chunk)
    } else chunks.push(data.subarray(offset,end))
    offset=end
  }
  if (!changed || offset !== data.length) return data
  const result=Buffer.concat([data.subarray(0,12),...chunks])
  result.writeUInt32LE(result.length-8,4)
  return result
}

function stripPngMetadata(input) {
  const data=Buffer.from(input)
  if (data.length < PNG_SIGNATURE.length || !data.subarray(0,PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return data
  const chunks=[]
  let offset=PNG_SIGNATURE.length,changed=false,sawEnd=false
  while (offset < data.length) {
    if (offset+12 > data.length) return data
    const length=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8),end=offset+12+length
    if (end > data.length) return data
    if (PNG_METADATA_CHUNKS.has(type)) changed=true
    else chunks.push(data.subarray(offset,end))
    offset=end
    if (type === 'IEND') { sawEnd=true;break }
  }
  if (!changed || !sawEnd || offset !== data.length) return data
  return Buffer.concat([PNG_SIGNATURE,...chunks])
}

export function canonicalCanvasCaptureImage(data, mediaType) {
  if (mediaType === 'image/webp') return stripWebpMetadata(data)
  if (mediaType === 'image/png') return stripPngMetadata(data)
  throw new Error('Canvas capture must use WebP or its PNG fallback.')
}

function pngVariantId(image) {
  return `sha256:${createHash('sha256').update(`${PNG_FALLBACK_VERSION}\0${image.variantId}`).digest('hex')}`
}

async function pngFallback(image, policy) {
  const source=Buffer.from(image.data)
  let width=image.width,height=image.height
  for (;;) {
    const { data,info }=await sharp(source,{failOn:'error',limitInputPixels:false}).toColourspace('srgb').resize({
      width,height,fit:'inside',withoutEnlargement:true,
    }).png({compressionLevel:9}).toBuffer({resolveWithObject:true})
    if (data.length <= policy.maxBytes) return {
      ...image,
      variantId:pngVariantId(image),
      data:new Uint8Array(data),
      mediaType:'image/png',
      bytes:data.length,
      width:info.width,
      height:info.height,
      hasAlpha:false,
    }
    if (width === 1 && height === 1) throw new Error('PenEcho Agent PNG fallback exceeds the model request image limit.')
    const scale=Math.min(.9,Math.sqrt(policy.maxBytes/data.length)*.95)
    const nextWidth=Math.max(1,Math.floor(width*scale)),nextHeight=Math.max(1,Math.floor(height*scale))
    width=nextWidth === width && width > 1 ? width-1 : nextWidth
    height=nextHeight === height && height > 1 ? height-1 : nextHeight
  }
}

function waitForShared(promise, signal) {
  signal?.throwIfAborted()
  if (!signal) return promise
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason instanceof Error ? signal.reason : new Error('PenEcho Agent image request was cancelled.'))
    signal.addEventListener('abort',abort,{once:true})
    promise.then(value=>{ signal.removeEventListener('abort',abort);resolve(value) },error=>{ signal.removeEventListener('abort',abort);reject(error) })
  })
}

export class PenEchoAttachmentStore extends LocalAttachmentStore {
  constructor(ctx,config={}) {
    super(ctx,{...PENECHO_ATTACHMENT_NORMALIZATION,...config})
  }
  pngFallbacks=new Map()
  requestImageObserver=null
  activeOperations=0
  retentionProtected=()=>false
  retention=null
  pendingDeletion=null

  async canonicalPngInput(input) {
    if (input.mediaType !== 'image/png') return input
    return this.compression.run(async () => {
      // Check the original before conversion: it must not disguise a different
      // format or evade the source-byte, decoded-pixel or dimension limits.
      await validateImageFile(input,this.imageLimits,this.normalizationPolicy)
      const metadata=await sharp(input.data,{failOn:'error',limitInputPixels:this.imageLimits.maxImagePixels}).metadata()
      if ((metadata.pages || 1) > 1) return input
      const carriesMetadata=metadata.hasProfile || ['exif','xmp','iptc','icc','tifftagPhotoshop','comments','orientation'].some(key=>metadata[key]!==undefined)
      const fits=(width,height,bytes)=>width*height<=this.normalizationPolicy.maxPixels
        && Math.max(width,height)<=this.normalizationPolicy.maxDimension && bytes<=this.normalizationPolicy.maxBytes
      if (metadata.depth==='uchar' && metadata.space==='srgb' && !carriesMetadata && fits(metadata.width,metadata.height,input.data.byteLength)) return input
      const {data,info}=await sharp(input.data,{failOn:'error',limitInputPixels:this.imageLimits.maxImagePixels})
        .rotate().toColourspace('srgb').png().toBuffer({resolveWithObject:true})
      return fits(info.width,info.height,data.byteLength) ? {...input,data} : input
    })
  }

  async withActiveOperation(operation) {
    this.activeOperations++
    try {
      // A new upload of the same hash cannot race a deletion already issued to the filesystem.
      // This waits only for one unlink, never for a scan or another retention round.
      await this.pendingDeletion?.catch(()=>{})
      return await operation()
    } finally { this.activeOperations-- }
  }

  async renewUpload(ref) {
    const hash = String(ref?.attachmentId || '').replace(/^sha256:/,'')
    if (/^[a-f0-9]{64}$/.test(hash)) {
      const now = new Date()
      await utimes(join(this.root,'objects',hash.slice(0,2),hash),now,now).catch(()=>{})
    }
    return ref
  }
  async saveImage(input) { return this.withActiveOperation(async()=>this.renewUpload(await super.saveImage(await this.canonicalPngInput(input)))) }
  async saveImages(inputs) { return this.withActiveOperation(async()=>{
    this.validateImageBatch(inputs)
    const prepared=await Promise.all(inputs.map(input=>this.canonicalPngInput(input)))
    const refs = await super.saveImages(prepared)
    for (const ref of refs) await this.renewUpload(ref)
    return refs
  }) }
  async readImage(ref, signal) { return this.withActiveOperation(()=>super.readImage(ref,signal)) }

  cleanupExpiredFiles(options = {}) {
    this.retention ||= new ManagedFileRetention({
      root:this.root, policy:attachmentRetention,
      directoryAllowed:relative=>/^(objects|request-images)(\/[a-f0-9]{2})?$/.test(relative)||relative==='tmp',
      protectedFile:relative=>this.activeOperations>0||this.retentionProtected(relative),
      deleteFile:(path,relative)=>{
        if (this.activeOperations>0||this.retentionProtected(relative)) return false
        this.pendingDeletion=unlink(path).finally(()=>{this.pendingDeletion=null})
        return this.pendingDeletion.then(()=>true)
      },
    })
    return this.retention.runOnce(options)
  }

  async closeRetention() { await this.retention?.close() }

  async readImageRequest(ref, policy, signal) {
    return this.withActiveOperation(()=>this.readImageRequestActive(ref,policy,signal))
  }

  async readImageRequestActive(ref, policy, signal) {
    const target=policy.maxPixels
      ? { ...requestImageDimensions(ref.width,ref.height,policy.maxPixels), maxBytes:policy.maxBytes }
      : policy
    const image=await super.readImageRequest(ref,target,signal)
    let output=image
    if (image.mediaType === 'image/jpeg') {
      const key=String(image.variantId)
      let promise=this.pngFallbacks.get(key)
      if (!promise) {
        promise=pngFallback(image,policy)
        this.pngFallbacks.set(key,promise)
        promise.catch(()=>{ if (this.pngFallbacks.get(key) === promise) this.pngFallbacks.delete(key) })
        while (this.pngFallbacks.size > PNG_FALLBACK_CACHE_LIMIT) this.pngFallbacks.delete(this.pngFallbacks.keys().next().value)
      } else {
        this.pngFallbacks.delete(key)
        this.pngFallbacks.set(key,promise)
      }
      output=await waitForShared(promise,signal)
    }
    try { this.requestImageObserver?.({ ref, policy, image:output }) } catch {}
    return output
  }
}

export default PenEchoAttachmentStore
