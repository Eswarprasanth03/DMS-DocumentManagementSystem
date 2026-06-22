import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Button, Badge, Progress, StateBadge } from '../components/ui.jsx'
import { confidenceTone } from '../lib/theme.js'
import { IconUpload, IconFile, IconBrain, IconCheck, IconWarning, IconFolderOpen } from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../hooks/useApi.js'

export default function Upload() {
  const [queue, setQueue] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [dupWarning, setDupWarning] = useState(null)
  const inputRef = useRef(null)
  const { data: channelData, reload: reloadChannels } = useApi(() => api.channels(), [])

  const processFile = async (file) => {
    const localId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setQueue((q) => [
      { id: localId, name: file.name, size: `${(file.size / 1024).toFixed(0)} KB`, stage: 'Uploading', progress: 30, confidence: null, type: null, docId: null },
      ...q,
    ])
    try {
      // Simulate the OCR/classify stages advancing while the request is in flight.
      setTimeout(() => setQueue((q) => q.map((i) => (i.id === localId && i.progress < 70 ? { ...i, stage: 'OCR', progress: 55 } : i))), 250)
      setTimeout(() => setQueue((q) => q.map((i) => (i.id === localId && i.progress < 90 ? { ...i, stage: 'Classifying', progress: 80 } : i))), 600)

      const { document, duplicateOf } = await api.uploadFile(file)
      if (duplicateOf) setDupWarning(`${document.name} matches ${duplicateOf.name}`)
      reloadChannels()
      setQueue((q) =>
        q.map((i) =>
          i.id === localId
            ? { ...i, stage: document.status, progress: 100, confidence: document.confidence, type: document.type, docId: document.id, status: document.status }
            : i,
        ),
      )
    } catch (err) {
      setQueue((q) => q.map((i) => (i.id === localId ? { ...i, stage: 'Failed', progress: 100, error: err.message } : i)))
    }
  }

  const addFiles = (files) => {
    Array.from(files).forEach(processFile)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <PageHeader
        title="Capture & Upload"
        subtitle="Manual upload, hot-folder drop, email-to-ingest and API push all feed the same pipeline."
        actions={<Badge tone="info"><IconFolderOpen className="w-3.5 h-3.5" /> Hot-folder: watching /drop</Badge>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-gray-50'
            }`}
          >
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <IconUpload className="w-7 h-7" />
            </div>
            <div className="mt-4 text-sm font-semibold text-gray-800">Drag & drop files, or click to browse</div>
            <div className="mt-1 text-xs text-gray-500">Files are OCR'd, classified, auto-named and filed automatically — no manual sorting</div>
            <Button variant="gradient" className="mt-4" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
              <IconUpload className="w-4 h-4" /> Select files
            </Button>
            <div className="mt-2 text-[11px] text-gray-400">Tip: name a file like <code className="bg-gray-100 px-1 rounded">taxi-ola.txt</code> or <code className="bg-gray-100 px-1 rounded">hotel-taj.txt</code> to see classification in action.</div>
          </div>

          {dupWarning && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
              <IconWarning className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-rose-800">Duplicate detected</div>
                <div className="text-xs text-rose-700">{dupWarning} — flagged for review rather than re-filed.</div>
              </div>
              <button onClick={() => setDupWarning(null)} className="text-rose-400 hover:text-rose-600 text-xs">Dismiss</button>
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Processing queue</h3>
              <span className="text-xs text-gray-500">{queue.length} items</span>
            </div>
            {queue.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No uploads yet — drop a file above to start.</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {queue.map((item) => (
                  <li key={item.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="p-2 rounded-lg bg-gray-50 text-gray-500"><IconFile className="w-4 h-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          {item.docId ? (
                            <Link to={`/document/${item.docId}`} className="text-sm text-gray-800 truncate hover:text-indigo-600">{item.name}</Link>
                          ) : (
                            <span className="text-sm text-gray-800 truncate">{item.name}</span>
                          )}
                          <StateBadge state={item.stage} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-3">
                          <Progress value={item.progress} tone={item.stage === 'Failed' ? 'error' : item.progress >= 100 ? 'success' : 'info'} className="flex-1" />
                          <span className="text-[11px] text-gray-500 w-10 text-right">{item.progress}%</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500">
                          <span>{item.size}</span>
                          {item.type && <><span>·</span><span>{item.type}</span></>}
                          {item.confidence != null && (
                            <><span>·</span>
                              <Badge tone={confidenceTone(item.confidence)}>
                                <IconBrain className="w-3 h-3" /> {Math.round(item.confidence * 100)}%
                              </Badge></>
                          )}
                          {item.error && <span className="text-rose-600">· {item.error}</span>}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Ingest channels</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
              </span>
            </div>
            <ul className="space-y-3 text-sm">
              {Object.entries(channelData?.channels || {}).map(([key, ch]) => (
                <li key={key} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-gray-800">{ch.type}</div>
                    <div className="text-[11px] text-gray-500 truncate">{ch.detail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge tone={ch.status === 'active' ? 'success' : ch.status === 'connecting' ? 'warning' : 'neutral'}>
                      {ch.status || 'active'}
                    </Badge>
                    {ch.processed != null && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{ch.processed} ingested</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Drop files into <code className="text-gray-700">server/data/drop</code> or{' '}
              <code className="text-gray-700">/scanner</code>, or an <code className="text-gray-700">.eml</code> into{' '}
              <code className="text-gray-700">/maildrop</code> — they auto-ingest.
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">What happens automatically</h3>
            <ol className="space-y-3">
              {[
                ['OCR', 'Text extracted from the file content'],
                ['Classify', 'Document type assigned with a confidence score'],
                ['Auto-name', 'type-vendor-INV-number.pdf'],
                ['File', 'Routed to Client → Year → Trip → Category'],
                ['Tag & dedup', '10+ metadata fields, duplicate check'],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{title}</div>
                    <div className="text-[11px] text-gray-500">{text}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              <IconCheck className="w-4 h-4" /> Every step emits an immutable audit event.
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
