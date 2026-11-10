// Shared local/Cloud document readers. Resource authorization belongs to the caller.
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createRequire } from 'node:module'
import { readPptxPresentation } from './pptx-reader.mjs'
const require = createRequire(import.meta.url)
const { validateProjectFileContent } = require('./project-store.js')
const PROJECT_READ_MAX_LINES = 2000
const PROJECT_READ_MAX_LINE_LENGTH = 2000
const PROJECT_READ_MAX_BYTES = 50 * 1024
function attachmentImageValue(ref) {
  return {
    attachmentId:String(ref.attachmentId), mediaType:ref.mediaType, bytes:ref.bytes, width:ref.width, height:ref.height,
    ...(ref.name ? { name:ref.name } : {}), ...(ref.originalDimensions ? { originalDimensions:{ ...ref.originalDimensions } } : {}),
  }
}
function projectReadPositiveInteger(value, fallback, label) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`)
  return parsed
}

function projectReadWindow(offsetInput, limitInput) {
  const offset = projectReadPositiveInteger(offsetInput, 1, 'offset')
  const limit = projectReadPositiveInteger(limitInput, PROJECT_READ_MAX_LINES, 'limit')
  if (limit > PROJECT_READ_MAX_LINES) throw new Error(`limit must be less than or equal to ${PROJECT_READ_MAX_LINES}`)
  return { offset, limit, lines:[], bytes:0, cappedByBytes:false }
}

function projectReadLine(value) {
  const line = String(value ?? '')
  return line.length > PROJECT_READ_MAX_LINE_LENGTH
    ? `${line.slice(0, PROJECT_READ_MAX_LINE_LENGTH)}... (line truncated to ${PROJECT_READ_MAX_LINE_LENGTH} chars)`
    : line
}

function projectReadWindowAppend(window, number, value) {
  if (number < window.offset || window.cappedByBytes || window.lines.length >= window.limit) return
  const text = projectReadLine(value), bytes = Buffer.byteLength(text, 'utf8') + (window.lines.length ? 1 : 0)
  if (window.bytes + bytes > PROJECT_READ_MAX_BYTES) {
    window.cappedByBytes = true
    return
  }
  window.lines.push({ number, text })
  window.bytes += bytes
}

function projectReadWindowText(window, total, unit) {
  const singular = unit.endsWith('s') ? unit.slice(0, -1) : unit
  if (!window.lines.length && window.offset > Math.max(1, total)) throw new Error(`offset ${window.offset} is outside this ${total}-${singular} file.`)
  const end = window.lines.at(-1)?.number ?? Math.max(0, window.offset - 1)
  let footer
  if (window.cappedByBytes) footer = `(Output capped. Showing ${unit} ${window.offset}-${end}. Use offset=${end + 1} to continue.)`
  else if (end < total) footer = `(Showing ${unit} ${window.offset}-${end} of ${total}. Use offset=${end + 1} to continue.)`
  else footer = `(End of file - total ${total} ${unit})`
  return `${window.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}`
}

function projectReadStringWindow(value, offsetInput, limitInput) {
  const source = String(value ?? ''), lines = source ? source.split('\n') : []
  if (source.endsWith('\n')) lines.pop()
  const window = projectReadWindow(offsetInput, limitInput)
  for (let index = 0; index < lines.length; index++) projectReadWindowAppend(window, index + 1, lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index])
  return { total:lines.length, text:projectReadWindowText(window, lines.length, 'lines') }
}

async function readPdfDocument(localPath, page, offset, limit, renderPage, attachments, displayName = basename(localPath), policy = {}) {
  if (policy.textOnly && renderPage) throw new Error("Cloud PDF attachments support text extraction only; page rendering and OCR are unavailable.")
  const { PDFParse } = await import('pdf-parse'), data = new Uint8Array(await readFile(localPath)), parser = new PDFParse({ data })
  try {
    if (page !== undefined && (!Number.isInteger(Number(page)) || Number(page) < 1)) throw new Error('PDF page must be a positive 1-based integer.')
    const requestedPage = page === undefined ? null : Number(page)
    const result = await parser.getText(requestedPage ? { partial:[requestedPage] } : undefined)
    if (requestedPage && requestedPage > result.total) throw new Error(`PDF page ${requestedPage} is outside this ${result.total}-page document.`)
    const pages = Array.isArray(result.pages) ? result.pages : []
    const blankPages = pages.filter(item => !String(item.text || '').trim())
    if (policy.textOnly && (pages.length ? blankPages.length === pages.length : !String(result.text || '').trim())) {
      const error = new Error('This PDF has no extractable text. Scanned PDFs and OCR are not supported; upload a PDF with a text layer.')
      error.code = 'DOCUMENT_TEXT_LAYER_REQUIRED'
      throw error
    }
    const warning = policy.textOnly ? '\nOnly the PDF text layer was read; images and scanned content were not inspected.' + (blankPages.length ? ` ${blankPages.length} selected page(s) had no extractable text.` : '') : ''
    let image
    if (renderPage === true) {
      const pageNumber = requestedPage || 1, metadata = await parser.getInfo({ partial:[pageNumber], parsePageInfo:true }), pageInfo = metadata.pages[0]
      if (!pageInfo || !Number.isFinite(pageInfo.width) || !Number.isFinite(pageInfo.height) || pageInfo.width <= 0 || pageInfo.height <= 0) {
        throw new Error(`PDF page ${pageNumber} has invalid dimensions.`)
      }
      const scale = Math.min(1400 / Math.max(pageInfo.width, pageInfo.height), Math.sqrt(1_800_000 / (pageInfo.width * pageInfo.height)))
      if (!Number.isFinite(scale) || scale <= 0) throw new Error(`PDF page ${pageNumber} cannot be rendered within the image limits.`)
      const desiredWidth = Math.max(1, Math.floor(pageInfo.width * scale)), screenshot = await parser.getScreenshot({ partial:[pageNumber], desiredWidth, imageDataUrl:false, imageBuffer:true }), rendered = screenshot.pages[0]
      if (!rendered?.data?.length) throw new Error(`PDF page ${pageNumber} could not be rendered.`)
      if (!Number.isFinite(rendered.width) || !Number.isFinite(rendered.height) || rendered.width * rendered.height > 1_800_000 || Math.max(rendered.width, rendered.height) > 1400) {
        throw new Error(`PDF page ${pageNumber} exceeded the rendered image limits.`)
      }
      image = attachmentImageValue(await attachments.saveImage({ data:rendered.data, mediaType:'image/png', name:`${displayName}-page-${pageNumber}.png` }))
    }
    const window = projectReadStringWindow(result.text, offset, limit)
    return { text:`PDF: ${displayName}\nPages: ${result.total}${requestedPage ? `\nSelected page: ${requestedPage}` : ''}\nExtracted lines: ${window.total}${warning}\n\n${window.text}`, ...(image ? { image } : {}) }
  } finally { await parser.destroy() }
}

async function readWordDocument(localPath, offset, limit, displayName = basename(localPath)) {
  const module = await import('mammoth'), mammoth = module.default || module, result = await mammoth.extractRawText({ path:localPath })
  const window = projectReadStringWindow(result.value, offset, limit)
  return { text:`Word document: ${displayName}\nExtracted lines: ${window.total}\n\n${window.text}` }
}

function presentationSlideText(slide) {
  const sections = [
    `Slide ${slide.number}`,
    `Text:\n${slide.paragraphs.length ? slide.paragraphs.join('\n') : '(no extractable text)'}`,
  ]
  if (slide.notes.length) sections.push(`Speaker notes:\n${slide.notes.join('\n')}`)
  sections.push(`Embedded images: ${slide.imageCount}`)
  return sections.join('\n')
}

async function readPptxDocument(localPath, slide, offset, limit, displayName, signal) {
  try {
    const bytes = await readFile(localPath)
    await validateProjectFileContent(displayName, bytes)
    const presentation = await readPptxPresentation(bytes, { slide, signal })
    const selection = presentation.slides.length ? presentation.slides.map(presentationSlideText).join('\n\n') : '(no slides)', window = projectReadStringWindow(selection, offset, limit)
    return { text:`Presentation: ${displayName}\nSlides: ${presentation.totalSlides}${slide === undefined ? '' : `\nSelected slide: ${slide}`}\nExtracted lines: ${window.total}\n\n${window.text}\n\n${slide === undefined ? 'For targeted reading, pass slide=N to select one slide.' : `Continue this slide with slide=${slide} and offset=N when the window footer requests it.`}` }
  } catch (cause) {
    if (signal?.aborted || String(cause?.code || '').startsWith('PRESENTATION_SLIDE_')) throw cause
    throw new Error('The PPTX presentation could not be parsed. Re-save it as a standard PPTX file, then try again.', { cause })
  }
}

async function readCsvDocument(localPath, offsetInput, limitInput, displayName) {
  const csvModule = await import('@fast-csv/parse'), parse = csvModule.parse || csvModule.default?.parse
  if (typeof parse !== 'function') throw new Error('The CSV reader is unavailable.')
  const window = projectReadWindow(offsetInput, limitInput), input = createReadStream(localPath), parser = parse({ headers:false, ignoreEmpty:false })
  let rowNumber = 0
  input.pipe(parser)
  try {
    for await (const row of parser) {
      rowNumber += 1
      const cells = (Array.isArray(row) ? row : Object.values(row)).slice(0, 100).map(value => String(value ?? ''))
      projectReadWindowAppend(window, rowNumber, cells.join('\t'))
    }
  } finally { input.destroy(); parser.destroy() }
  return { text:`Spreadsheet: ${displayName}\nSheet: CSV\nRows: ${rowNumber}\n\n${projectReadWindowText(window, rowNumber, 'rows')}` }
}

function spreadsheetCellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  return String(value)
}

function spreadsheetSheetNotFoundError(availableSheets, requestedSheet) {
  const requestedLabel=requestedSheet === undefined || requestedSheet === null ? '(default)' : JSON.stringify(String(requestedSheet)),
    availableLabels=availableSheets.map(sheet=>JSON.stringify(String(sheet))).join(', ')
  const error = new Error(`Spreadsheet sheet was not found. Requested sheet: ${requestedLabel}. Available sheets: ${availableLabels}`)
  error.code = 'SPREADSHEET_SHEET_NOT_FOUND'
  return error
}

async function readXlsxDocument(localPath, sheetName, offsetInput, limitInput, displayName) {
  let worksheets
  try {
    const module = await import('read-excel-file/node'), readWorkbook = module.default
    if (typeof readWorkbook !== 'function') throw new Error('The XLSX reader is unavailable.')
    worksheets = await readWorkbook(localPath)
  } catch (cause) {
    throw new Error('The XLSX workbook could not be parsed. Re-save it as a standard XLSX file or export it as CSV, then try again.', { cause })
  }
  const availableSheets = worksheets.map(sheet => String(sheet.sheet))
  const worksheet = sheetName
    ? worksheets.find(sheet => String(sheet.sheet) === String(sheetName))
    : worksheets[0]
  if (!worksheet) throw spreadsheetSheetNotFoundError(availableSheets, sheetName)
  const window = projectReadWindow(offsetInput, limitInput)
  for (let rowNumber = window.offset; rowNumber <= worksheet.data.length; rowNumber++) {
    const cells = (Array.isArray(worksheet.data[rowNumber - 1]) ? worksheet.data[rowNumber - 1] : []).slice(0, 100).map(spreadsheetCellText)
    projectReadWindowAppend(window, rowNumber, cells.join('\t'))
    if (window.cappedByBytes || window.lines.length >= window.limit) break
  }
  return { text:`Spreadsheet: ${displayName}\nSheet: ${worksheet.sheet}\nAvailable sheets: ${availableSheets.join(', ')}\nRows: ${worksheet.data.length}\n\n${projectReadWindowText(window, worksheet.data.length, 'rows')}` }
}

async function readSpreadsheetDocument(localPath, sheetName, offsetInput, limitInput, displayName = basename(localPath)) {
  const extension = extname(localPath).toLowerCase()
  if (extension === '.csv') return await readCsvDocument(localPath, offsetInput, limitInput, displayName)
  return await readXlsxDocument(localPath, sheetName, offsetInput, limitInput, displayName)
}


export { projectReadPositiveInteger, projectReadWindow, projectReadWindowAppend, projectReadWindowText, projectReadStringWindow, readPdfDocument, readWordDocument, readSpreadsheetDocument, readPptxDocument }
