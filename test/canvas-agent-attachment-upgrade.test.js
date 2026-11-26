require('./helpers/safety.js');
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const sharp = require('sharp')

async function fixture(t, config = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const { PenEchoAttachmentStore } = await import('../src/server/canvas-agent/image-attachments.mjs')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-attachment-upgrade-'))
  const ctx = new Context(), store = new PenEchoAttachmentStore(ctx, { dshHome:directory, ...config })
  t.after(async () => { await store.closeRetention(); await ctx.fiber.dispose(); fs.rmSync(directory, { recursive:true, force:true }) })
  return store
}

test('PNG capture admission preserves clean bytes, grayscale pixels, transparency and orientation', async t => {
  const store = await fixture(t)
  const gray = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64')
  const clean = await sharp({ create:{ width:2, height:3, channels:4, background:{ r:12, g:45, b:76, alpha:0.25 } } }).png().toBuffer()
  const ref = await store.saveImage({ data:clean, mediaType:'image/png' })
  assert.equal(ref.mediaType, 'image/png')
  assert.deepEqual(Buffer.from((await store.readImage(ref)).data), clean)
  const grayRef = await store.saveImage({ data:gray, mediaType:'image/png' })
  assert.equal(grayRef.mediaType, 'image/png')
  assert.equal(grayRef.width, 1); assert.equal(grayRef.height, 1)
  const grayStored = Buffer.from((await store.readImage(grayRef)).data)
  assert.deepEqual(await sharp(grayStored).toColourspace('srgb').ensureAlpha().raw().toBuffer(), await sharp(gray).toColourspace('srgb').ensureAlpha().raw().toBuffer())
  assert.equal((await sharp((await store.readImage(ref)).data).stats()).channels[3].min, 64)
  const oriented = await sharp(clean).withMetadata({ orientation:6 }).png().toBuffer()
  const orientedRef = await store.saveImage({ data:oriented, mediaType:'image/png' })
  assert.equal(orientedRef.mediaType, 'image/png')
  assert.equal(orientedRef.width, 3); assert.equal(orientedRef.height, 2)
  const request = await store.readImageRequest(orientedRef, { maxPixels:2, maxBytes:1024 * 1024 })
  assert.ok(request.width * request.height <= 2)
})

test('original image limits and declared types are checked before conversion and batch publication', async t => {
  const store = await fixture(t)
  const png = await sharp({ create:{ width:2, height:2, channels:4, background:'transparent' } }).png().toBuffer()
  const jpeg = await sharp(png).jpeg().toBuffer()
  await assert.rejects(store.saveImages([{ data:png, mediaType:'image/png' }, { data:jpeg, mediaType:'image/png' }]), /Declared image type/)
  assert.equal(fs.existsSync(path.join(store.root, 'objects')), false, 'a bad batch publishes no good prefix')
  const limited = await fixture(t, { maxImageBytes:32 })
  await assert.rejects(limited.saveImage({ data:png, mediaType:'image/png' }), /byte limit/)
  assert.equal(fs.existsSync(path.join(limited.root, 'objects')), false)
})

test('pre-upgrade hash-addressed PNG objects remain readable without rewriting', async t => {
  const store = await fixture(t)
  // Output of the published 0.1.1-rc.2 prepareImageFile for the grayscale fixture.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAsSAAALEgHS3X78AAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==', 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const file = path.join(store.root, 'objects', hash.slice(0, 2), hash)
  fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, bytes)
  const ref = { attachmentId:`sha256:${hash}`, mediaType:'image/png', width:1, height:1, bytes:bytes.length }
  const before = fs.statSync(file)
  assert.deepEqual(Buffer.from((await store.readImage(ref)).data), bytes)
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs)
})
