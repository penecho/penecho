'use strict';
const crypto = require('node:crypto');
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 40000000;
const MAX_SOURCE = 800000;
const MAX_OUTPUT_DIMENSION = 2048;
const fail = (code,message,status=422) => Object.assign(new Error(message),{code,status});
function rasterType(b) {
  if (b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'png';
  if (b[0]===255 && b[1]===216 && b[2]===255) return 'jpeg';
  if (b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(b.toString('ascii',0,6))) return 'gif';
  if (['49492a00','4d4d002a','49492b00','4d4d002b'].includes(b.subarray(0,4).toString('hex'))) return 'tiff';
  if (b.toString('ascii',4,8)==='ftyp' && /^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(b.toString('ascii',8,12))) return 'heif';
  throw fail('unsupported_image','Upload a PNG, JPEG, WebP, GIF, TIFF, AVIF or HEIF image',415);
}
async function prepareUploadedImage(bytes,name,{signal}={}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('invalid_image','Image is empty');
  if (bytes.length>MAX_BYTES) throw fail('image_too_large','Image exceeds 32 MiB',413);
  signal?.throwIfAborted();
  const type=rasterType(bytes);
  let sharp;
  try { sharp=require('sharp'); } catch { throw fail('image_encoder_unavailable','Server image encoder is unavailable; reinstall PenEcho to restore its image dependencies',503); }
  const inputSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const run=async fn=>{
    signal?.throwIfAborted();
    const image=sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning',pages:1}).timeout({seconds:20});
    // Sharp's promise APIs do not consume stream error events. Let the native
    // operation settle and normalize cancellation below instead of emitting one.
    const abort=()=>image.destroy();
    signal?.addEventListener('abort',abort,{once:true});
    try { const result=await fn(image); signal?.throwIfAborted(); return result; }
    finally { signal?.removeEventListener('abort',abort); image.destroy(); }
  };
  try {
    const metadata=await run(image=>image.metadata());
    if (!metadata.width || !metadata.height || metadata.width*(metadata.pageHeight||metadata.height)>MAX_PIXELS) throw fail('image_too_large','Image exceeds 40 megapixels',413);
    let output=bytes, format=type, width=metadata.width, height=metadata.pageHeight||metadata.height;
    const dataURL=(buffer,fmt)=>`data:image/${fmt};base64,${buffer.toString('base64')}`;
    const sourceLength=(buffer,fmt)=>`data:image/${fmt};base64,`.length+4*Math.ceil(buffer.length/3);
    if (!['png','jpeg','webp'].includes(type) || (metadata.pages||1)>1 || Math.max(width,height)>MAX_OUTPUT_DIMENSION || sourceLength(bytes,type)>MAX_SOURCE) {
      const lossless=await run(image=>image.rotate().resize({width:MAX_OUTPUT_DIMENSION,height:MAX_OUTPUT_DIMENSION,fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toBuffer({resolveWithObject:true}));
      output=lossless.data;format='png';width=lossless.info.width;height=lossless.info.height;
      let edge=Math.min(MAX_OUTPUT_DIMENSION,Math.max(width,height));
      for (let attempt=0;sourceLength(output,format)>MAX_SOURCE && attempt<8;attempt++,edge=Math.floor(edge*0.75)) {
        const result=await run(image=>image.rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality:80,effort:4}).toBuffer({resolveWithObject:true}));
        output=result.data;format='webp';width=result.info.width;height=result.info.height;
        if(sourceLength(output,format)<=MAX_SOURCE) break;
      }
    } else {
      // Validate preserved bytes without allocating a full uncompressed raster
      // in JS. Transcoding above already decodes and validates its input.
      await run(image=>image.stats());
    }
    const source=dataURL(output,format);
    if(source.length>MAX_SOURCE) throw fail('image_too_large','Image could not fit the Canvas image limit',413);
    const base=String(name).replace(/\.[^.]*$/,'').replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,190)||'image';
    return {source,name:`${base}.${format==='jpeg'?'jpg':format}`,originalName:name,inputSha256,mimeType:`image/${format}`,width,height};
  } catch(error) {
    if(signal?.aborted) throw fail('upload_cancelled','Upload cancelled',408);
    if(error.status) throw error;
    if(type==='heif' && /unsupported.*(codec|compression)|no decoding plugin|support for.*compression|heif.*not supported/i.test(error.message)) throw fail('image_codec_unavailable','This server cannot decode this HEIF codec; export the image as PNG, JPEG or AVIF and retry',415);
    if(/pixel limit/i.test(error.message)) throw fail('image_too_large','Image exceeds 40 megapixels',413);
    throw fail('invalid_image','Image bytes could not be decoded');
  }
}
module.exports={prepareUploadedImage,MAX_BYTES,MAX_PIXELS,MAX_SOURCE,MAX_OUTPUT_DIMENSION};
