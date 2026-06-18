import { createCanvas } from '@napi-rs/canvas'

// Pure-JS PDF → PNG page rasterizer (pdfjs-dist + @napi-rs/canvas).
// No system dependencies (no Poppler/Ghostscript) — prebuilt binaries only.
// Used to OCR scanned/image-only PDFs that have no text layer.

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(cc, width, height) {
    cc.canvas.width = Math.ceil(width)
    cc.canvas.height = Math.ceil(height)
  }
  destroy(cc) {
    cc.canvas.width = 0
    cc.canvas.height = 0
  }
}

// Render up to `maxPages` pages to PNG buffers at the given scale.
export async function rasterizePdf(buffer, { maxPages = 5, scale = 2.0 } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const canvasFactory = new NodeCanvasFactory()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    canvasFactory,
  })
  const doc = await loadingTask.promise

  const pages = []
  const count = Math.min(doc.numPages, maxPages)
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale })
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height)
    await page.render({ canvasContext: context, viewport, canvasFactory }).promise
    pages.push(canvas.toBuffer('image/png'))
    try { page.cleanup() } catch { /* ignore */ }
  }
  try { await loadingTask.destroy() } catch { /* ignore */ }
  return pages
}
