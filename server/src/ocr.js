import { config } from './config.js'
import { mimeForName } from './mime.js'

// OCR / text-extraction adapter with smart routing:
//   - digital PDFs  → pdf-parse (fast text layer, with retry/lock/fresh-buffer)
//   - scanned PDFs  → rasterize pages (pdfjs + canvas) → Vision LLM OCR
//   - images        → Vision LLM OCR
//   - fallback      → Tesseract (if OCR_ENGINE=tesseract) → plain byte extract
// Vision uses the configured NVIDIA omni (multimodal) model. Never throws.

const IMAGE_EXT = /\.(png|jpe?g|tiff?|bmp|gif|webp)$/i
const SHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv)$/i

let pdfParseLock = Promise.resolve()
let tesseractWorker = null

function visionAvailable() {
  return Boolean(config.nvidiaApiKey) && config.ocrVision !== 'off'
}

function isPdf(buffer, filename) {
  if (/\.pdf$/i.test(filename)) return true
  return buffer && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}
function clean(text) {
  return String(text || '').replace(/^[\s,]+/, '').replace(/\s+/g, ' ').trim().slice(0, 8000)
}
function extractPlainText(buffer) {
  return clean(buffer.toString('utf-8').replace(/[^\x20-\x7e]+/g, ' '))
}

// ---- digital PDF text layer (pdf-parse, serialized + retried) -------------
async function extractPdfText(buffer) {
  const run = async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js')
        const parsed = await pdfParse(Buffer.from(buffer))
        return clean(parsed?.text)
      } catch (err) {
        console.warn(`[ocr] pdf-parse attempt ${attempt}/5: ${err.message}`)
        await new Promise((r) => setTimeout(r, 150 * attempt))
      }
    }
    return ''
  }
  const result = pdfParseLock.then(run, run)
  pdfParseLock = result.catch(() => undefined)
  return result
}

// ---- Spreadsheets (xlsx/xls/ods/csv) → flattened text ---------------------
async function extractSpreadsheet(buffer) {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const parts = []
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
      if (csv && csv.trim()) parts.push(`# ${name}\n${csv}`)
    }
    return clean(parts.join('\n').replace(/,+/g, ' ').replace(/"/g, ''))
  } catch (err) {
    console.warn('[ocr] spreadsheet parse failed:', err.message)
    return ''
  }
}

// ---- Vision LLM OCR (NVIDIA omni, OpenAI-compatible multimodal) ------------
async function visionOcr(imageBuffer, mime = 'image/png') {
  const url = `${config.nvidiaBaseUrl.replace(/\/$/, '')}/chat/completions`
  const b64 = imageBuffer.toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.nvidiaApiKey}` },
      body: JSON.stringify({
        model: config.nvidiaModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'You are an OCR engine. Transcribe ALL text in this document image exactly as it appears, preserving line order. Output only the transcription, no commentary.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        temperature: 0.1, max_tokens: 4096, stream: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return clean(data?.choices?.[0]?.message?.content)
  } finally {
    clearTimeout(timer)
  }
}

// ---- Tesseract (offline fallback) -----------------------------------------
async function getWorker() {
  if (tesseractWorker) return tesseractWorker
  const { createWorker } = await import('tesseract.js')
  console.log(config)
  tesseractWorker = await createWorker(config.ocrLanguage)
  return tesseractWorker
}
async function tesseractOcr(buffer) {
  const worker = await getWorker()
  const { data } = await worker.recognize(buffer)
  return { text: clean(data?.text), confidence: typeof data?.confidence === 'number' ? data.confidence : 0 }
}

// OCR pages of a scanned PDF via rasterization + vision/tesseract.
async function ocrScannedPdf(buffer) {
  const { rasterizePdf } = await import('./rasterize.js')
  const pages = await rasterizePdf(buffer, { maxPages: config.ocrMaxPages, scale: 2 })
  if (!pages.length) return { text: '', engine: null, confidence: 0 }
  if (visionAvailable()) {
    const parts = []
    for (const p of pages) {
      try { const t = await visionOcr(p, 'image/png'); if (t) parts.push(t) } catch (err) { console.warn('[ocr] vision page failed:', err.message) }
    }
    const joined = clean(parts.join('\n'))
    if (joined) return { text: joined, engine: 'vlm', confidence: 90 }
  }
  if (config.ocrEngine === 'tesseract') {
    let combined = ''
    for (const p of pages) { try { combined += `${(await tesseractOcr(p)).text}\n` } catch { /* ignore */ } }
    const t = clean(combined)
    if (t) return { text: t, engine: 'tesseract', confidence: 70 }
  }
  return { text: '', engine: null, confidence: 0 }
}

export async function ocrExtract(buffer, filename = '') {
  // 1) PDF — text layer first, then scanned-page OCR.
  if (isPdf(buffer, filename)) {
    const text = await extractPdfText(buffer)
    if (text && text.trim().length > 50) return { text, engine: 'pdf', confidence: 99 }
    try {
      const scanned = await ocrScannedPdf(buffer)
      if (scanned.text) return scanned
    } catch (err) {
      console.warn('[ocr] scanned-PDF OCR failed:', err.message)
    }
    return { text: text || extractPlainText(buffer), engine: 'pdf', confidence: text ? 60 : 0 }
  }

  // 2) Spreadsheets — parse cells to text (no OCR needed).
  if (SHEET_EXT.test(filename)) {
    const sheetText = await extractSpreadsheet(buffer)
    if (sheetText) return { text: sheetText, engine: 'sheet', confidence: 95 }
  }

  // 3) Image — vision OCR (one retry on empty), then Tesseract fallback.
  if (IMAGE_EXT.test(filename)) {
    if (visionAvailable()) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const t = await visionOcr(buffer, mimeForName(filename))
          if (t) return { text: t, engine: 'vlm', confidence: 90 }
        } catch (err) { console.warn(`[ocr] vision image attempt ${attempt}/2 failed:`, err.message) }
      }
    }
    if (config.ocrEngine === 'tesseract') {
      try {
        const r = await tesseractOcr(buffer)
        if (r.text) return { text: r.text, engine: 'tesseract', confidence: r.confidence }
      } catch (err) { console.warn('[ocr] tesseract image failed:', err.message) }
    }
  }

  // 4) Plain text / fallback.
  return { text: extractPlainText(buffer), engine: 'extract', confidence: 50 }
}

export async function ocrShutdown() {
  if (tesseractWorker) {
    try { await tesseractWorker.terminate() } catch { /* ignore */ }
    tesseractWorker = null
  }
}
