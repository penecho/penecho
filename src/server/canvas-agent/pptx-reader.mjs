import { posix as pathPosix } from 'node:path'

const DRAWINGML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
])
const MAX_PRESENTATION_SLIDES = 1_000
const MAX_PRESENTATION_XML_CHARS = 8 * 1024 * 1024

function presentationError(message, code = 'PRESENTATION_INVALID') {
  return Object.assign(new Error(message), { code })
}

function abortIfRequested(signal) {
  if (typeof signal?.throwIfAborted === 'function') signal.throwIfAborted()
  else if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The presentation read was cancelled.')
}

function parseXml(DOMParser, xml, label) {
  if (xml.length > MAX_PRESENTATION_XML_CHARS) throw presentationError(`The PPTX ${label} XML exceeds the safe reader limit.`)
  if (/<!DOCTYPE\b/i.test(xml)) throw presentationError(`The PPTX ${label} XML contains a forbidden document type.`)
  const errors = []
  const parser = new DOMParser({
    errorHandler:{
      warning:()=>{},
      error:message=>errors.push(String(message)),
      fatalError:message=>errors.push(String(message)),
    },
  })
  const document = parser.parseFromString(xml, 'application/xml')
  if (!document?.documentElement || errors.length) throw presentationError(`The PPTX ${label} XML is malformed.`)
  return document
}

function elements(document) {
  return Array.from(document.getElementsByTagName('*'))
}

function drawingElement(node, localName) {
  return node?.nodeType === 1 && node.localName === localName && DRAWINGML_NAMESPACES.has(node.namespaceURI)
}

function containsDrawingElement(root, localName) {
  return Array.from(root.getElementsByTagName('*')).some(node=>drawingElement(node, localName))
}

function paragraphText(paragraph) {
  const chunks = []
  const visit = node => {
    if (node !== paragraph && drawingElement(node, 't')) {
      chunks.push(node.textContent || '')
      return
    }
    if (drawingElement(node, 'br')) {
      chunks.push('\n')
      return
    }
    if (drawingElement(node, 'tab')) {
      chunks.push('\t')
      return
    }
    for (const child of Array.from(node.childNodes || [])) visit(child)
  }
  visit(paragraph)
  return chunks.join('').replaceAll('\r', '')
}

function extractParagraphs(document, { skipFields = false } = {}) {
  const paragraphs = []
  for (const element of elements(document)) {
    if (!drawingElement(element, 'p') || skipFields && containsDrawingElement(element, 'fld')) continue
    const text = paragraphText(element)
    if (text.trim()) paragraphs.push(text)
  }
  return paragraphs
}

function relationshipAttribute(element, localName) {
  for (const attribute of Array.from(element.attributes || [])) {
    if (attribute.localName === localName || attribute.name === localName) return attribute.value
  }
  return ''
}

function slideRelationshipId(element) {
  const relationship = Array.from(element.attributes || []).find(attribute=>attribute.localName === 'id'
    && (String(attribute.namespaceURI || '').includes('/relationships') || attribute.name.endsWith(':id')))
  return relationship?.value || ''
}

function resolveArchiveTarget(sourcePath, target) {
  const value = String(target || '').replaceAll('\\', '/')
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  const resolved = pathPosix.resolve('/', pathPosix.dirname(sourcePath), value).slice(1)
  return resolved && !resolved.startsWith('../') ? resolved : null
}

function relationshipPath(sourcePath) {
  return pathPosix.join(pathPosix.dirname(sourcePath), '_rels', `${pathPosix.basename(sourcePath)}.rels`)
}

async function relationshipsFor(zip, DOMParser, sourcePath) {
  const entry = zip.file(relationshipPath(sourcePath))
  if (!entry) return []
  const document = parseXml(DOMParser, await entry.async('string'), `${pathPosix.basename(sourcePath)} relationships`)
  return elements(document).filter(element=>element.localName === 'Relationship').map(element=>({
    id:relationshipAttribute(element, 'Id'),
    type:relationshipAttribute(element, 'Type'),
    target:relationshipAttribute(element, 'Target'),
    targetMode:relationshipAttribute(element, 'TargetMode'),
  }))
}

function numericSlideOrder(name) {
  const match = /\/slide(\d+)\.xml$/i.exec(name)
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER
}

async function orderedSlidePaths(zip, DOMParser) {
  const discovered = zip.file(/^ppt\/slides\/slide\d+\.xml$/i).map(entry=>entry.name)
    .sort((left, right)=>numericSlideOrder(left) - numericSlideOrder(right))
  if (discovered.length > MAX_PRESENTATION_SLIDES) {
    throw presentationError(`The PPTX contains more than ${MAX_PRESENTATION_SLIDES} slides.`)
  }
  const presentationEntry = zip.file('ppt/presentation.xml')
  if (!presentationEntry) throw presentationError('The PPTX is missing ppt/presentation.xml.')
  const presentation = parseXml(DOMParser, await presentationEntry.async('string'), 'presentation')
  const relationships = await relationshipsFor(zip, DOMParser, 'ppt/presentation.xml')
  const slideTargets = new Map(relationships.filter(item=>item.type.endsWith('/slide') && item.targetMode.toLowerCase() !== 'external')
    .map(item=>[item.id, resolveArchiveTarget('ppt/presentation.xml', item.target)]))
  const ordered = []
  for (const slideId of elements(presentation).filter(element=>element.localName === 'sldId')) {
    const relationshipId = slideRelationshipId(slideId), target = slideTargets.get(relationshipId)
    if (target && zip.file(target)) ordered.push(target)
  }
  return ordered.length ? [...new Set(ordered)] : discovered
}

async function readSlide(zip, DOMParser, slidePath, number) {
  const entry = zip.file(slidePath)
  if (!entry) throw presentationError(`The PPTX is missing slide ${number}.`)
  const document = parseXml(DOMParser, await entry.async('string'), `slide ${number}`)
  const relationships = await relationshipsFor(zip, DOMParser, slidePath)
  const imageCount = relationships.filter(item=>item.type.endsWith('/image') && item.targetMode.toLowerCase() !== 'external').length
  const noteRelationship = relationships.find(item=>item.type.endsWith('/notesSlide') && item.targetMode.toLowerCase() !== 'external')
  let notes = []
  if (noteRelationship) {
    const notesPath = resolveArchiveTarget(slidePath, noteRelationship.target), notesEntry = notesPath ? zip.file(notesPath) : null
    if (notesEntry) notes = extractParagraphs(parseXml(DOMParser, await notesEntry.async('string'), `slide ${number} notes`), { skipFields:true })
  }
  return { number, paragraphs:extractParagraphs(document), notes, imageCount }
}

/**
 * Read bounded model-facing structure from a validated PPTX archive. The
 * Harness-facing plugin owns file capabilities and output limits; this module
 * only understands the OOXML presentation container.
 */
export async function readPptxPresentation(bytes, { slide, signal } = {}) {
  abortIfRequested(signal)
  const requestedSlide = slide === undefined || slide === null || slide === '' ? null : Number(slide)
  if (requestedSlide !== null && (!Number.isInteger(requestedSlide) || requestedSlide < 1)) {
    throw presentationError('PPTX slide must be a positive 1-based integer.', 'PRESENTATION_SLIDE_INVALID')
  }
  const [zipModule, xmlModule] = await Promise.all([import('jszip'), import('@xmldom/xmldom')])
  const JSZip = zipModule.default || zipModule, DOMParser = xmlModule.DOMParser || xmlModule.default?.DOMParser
  if (typeof JSZip?.loadAsync !== 'function' || typeof DOMParser !== 'function') throw presentationError('The PPTX reader is unavailable.')
  let zip
  try { zip = await JSZip.loadAsync(bytes) }
  catch (cause) { throw presentationError(`The PPTX ZIP container could not be opened: ${cause?.message || 'invalid archive'}.`) }
  abortIfRequested(signal)
  const paths = await orderedSlidePaths(zip, DOMParser), totalSlides = paths.length
  if (requestedSlide !== null && requestedSlide > totalSlides) {
    throw presentationError(`PPTX slide ${requestedSlide} is outside this ${totalSlides}-slide presentation.`, 'PRESENTATION_SLIDE_OUT_OF_RANGE')
  }
  const selected = requestedSlide === null ? paths.map((path, index)=>({ path, number:index + 1 })) : [{ path:paths[requestedSlide - 1], number:requestedSlide }]
  const slides = []
  for (const item of selected) {
    abortIfRequested(signal)
    slides.push(await readSlide(zip, DOMParser, item.path, item.number))
  }
  abortIfRequested(signal)
  return { totalSlides, slides }
}
