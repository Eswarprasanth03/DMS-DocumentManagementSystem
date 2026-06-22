import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, Button, Badge, StateBadge, EmptyState, Progress, Input, Select, Avatar, Loading, ErrorState } from '../components/ui.jsx'
import { confidenceTone } from '../lib/theme.js'
import {
  IconFile, IconChevronRight, IconBrain, IconTag, IconHistory, IconLock,
  IconDownload, IconSignature, IconWarning, IconCheck, IconPlus, IconX, IconEye, IconPen, IconCopy,
} from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount, relTime } from '../lib/format.js'
import { useAuth } from '../context/AuthContext.jsx'

const ALL_TYPES = [
  'Invoice', 'GST Invoice', 'Receipt', 'Travel Bill', 'Hotel Invoice', 'Fuel Bill',
  'Taxi Receipt', 'Meal Bill', 'Purchase Order', 'Goods Receipt', 'Bank Statement', 'GST Return',
  'Contract', 'MSA', 'NDA', 'Offer Letter', 'Experience Letter', 'HR Document',
  'Compliance Document', 'Miscellaneous',
]
const RETENTIONS = ['3yr', '5yr', '7yr', '8yr', 'active+3yr', 'permanent']

const TABS = ['Metadata', 'Versions', 'Audit']

// Sender provenance for email-ingested documents — so an admin can trace a
// false / incorrect file straight back to whoever emailed it.
function SenderCard({ meta, flagged, reason }) {
  const [copied, setCopied] = useState('')
  const display = meta.fromName || meta.from
  const copy = (val, key) => {
    try { navigator.clipboard.writeText(val) } catch { /* ignore */ }
    setCopied(key); setTimeout(() => setCopied(''), 1500)
  }
  return (
    <Card className={`p-5 ${flagged ? 'ring-1 ring-rose-200' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Email sender</h3>
        <Badge tone={flagged ? 'error' : 'info'}>{flagged ? 'Flagged' : 'Received by email'}</Badge>
      </div>

      {flagged && (
        <div className="mb-3 rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2 flex items-start gap-2">
          <IconWarning className="w-4 h-4 mt-0.5 shrink-0" />
          <span>This file was flagged{reason ? ` — ${reason}` : ''}. Verify with the sender below before actioning.</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Avatar name={display} className="w-10 h-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 truncate">{display}</div>
          <div className="flex items-center gap-1.5">
            <a href={`mailto:${meta.from}`} className="text-xs text-indigo-600 hover:text-indigo-700 truncate">{meta.from}</a>
            <button onClick={() => copy(meta.from, 'from')} title="Copy email" className="text-gray-400 hover:text-gray-600">
              {copied === 'from' ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        {meta.subject && (
          <div>
            <dt className="text-[11px] text-gray-500">Subject</dt>
            <dd className="text-gray-800 break-words">{meta.subject}</dd>
          </div>
        )}
        {meta.receivedAt && (
          <div>
            <dt className="text-[11px] text-gray-500">Received</dt>
            <dd className="text-gray-800" title={new Date(meta.receivedAt).toLocaleString()}>
              {relTime(meta.receivedAt)} · {new Date(meta.receivedAt).toLocaleString()}
            </dd>
          </div>
        )}
        {meta.to && (
          <div>
            <dt className="text-[11px] text-gray-500">Sent to</dt>
            <dd className="text-gray-800 break-words">{meta.to}</dd>
          </div>
        )}
        {meta.messageId && (
          <div>
            <dt className="text-[11px] text-gray-500">Message ID</dt>
            <dd className="flex items-center gap-1.5">
              <span className="text-gray-500 text-xs truncate font-mono">{meta.messageId}</span>
              <button onClick={() => copy(meta.messageId, 'mid')} title="Copy message ID" className="text-gray-400 hover:text-gray-600 shrink-0">
                {copied === 'mid' ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
              </button>
            </dd>
          </div>
        )}
      </dl>

      <a href={`mailto:${meta.from}?subject=${encodeURIComponent(`Re: ${meta.subject || 'document you sent'}`)}`} className="mt-4 block">
        <Button variant="secondary" size="sm" className="w-full">Reply to sender</Button>
      </a>
    </Card>
  )
}

export default function DocumentView() {
  const { id } = useParams()
  const { data, loading, error, reload } = useApi(async () => {
    const [doc, versions, audit] = await Promise.all([
      api.document(id), api.versions(id), api.documentAudit(id),
    ])
    return { doc: doc.document, versions: versions.versions, audit: audit.audit }
  }, [id])

  const { can } = useAuth()
  const [tab, setTab] = useState('Metadata')
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [preview, setPreview] = useState({ loading: false, error: false, kind: null, url: null, html: '', text: '' })

  // Load the ORIGINAL uploaded file (from GridFS) and prepare an inline preview
  // appropriate to its type (PDF, image, spreadsheet, Word, text, or fallback).
  const docId = data?.doc?.id
  const storageKey = data?.doc?.storageKey
  const docName = data?.doc?.name
  useEffect(() => {
    if (!storageKey) { setPreview({ loading: false, error: false, kind: 'none' }); return undefined }
    let active = true
    let objectUrl = null
    setPreview({ loading: true, error: false, kind: null })
    ;(async () => {
      try {
        const blob = await api.fileBlob(docId)
        const kind = kindForName(docName)
        // Always expose an object URL so Open/Download work for every type.
        objectUrl = URL.createObjectURL(blob)
        const next = { loading: false, error: false, kind, url: objectUrl, html: '', text: '' }
        if (kind === 'pdf' || kind === 'image') {
          // rendered directly from next.url
        } else if (kind === 'text') {
          next.text = (await blob.text()).slice(0, 200000)
        } else if (kind === 'sheet') {
          const XLSX = await import('xlsx')
          const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
          next.sheetNames = wb.SheetNames
          next.html = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]])
        } else if (kind === 'word') {
          const mammoth = await import('mammoth/mammoth.browser.js')
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
          next.html = value || '<p class="text-gray-400">Empty document</p>'
        }
        if (active) setPreview(next)
        else if (objectUrl) URL.revokeObjectURL(objectUrl)
      } catch {
        if (active) setPreview({ loading: false, error: true, kind: 'error' })
      }
    })()
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [docId, storageKey, docName])

  if (loading) return <Loading label="Loading document…" />
  if (error && error.status === 404) {
    return (
      <Card className="mt-2">
        <EmptyState icon={<IconFile className="w-12 h-12" />} title="Document not found" hint="It may have been tombstoned or you lack permission."
          action={<Link to="/browse"><Button>Back to browse</Button></Link>} />
      </Card>
    )
  }
  if (error) return <ErrorState error={error} onRetry={reload} />

  const { doc, versions, audit } = data
  const tags = doc.tags || []
  const docConf = doc.documentConfidence ?? doc.confidence ?? 0
  const fields = doc.fields || {}

  const saveTags = async (nextTags) => {
    setBusy(true)
    try { await api.updateDocument(doc.id, { tags: nextTags, note: 'Edited tags' }); await reload() }
    finally { setBusy(false) }
  }
  const addTag = () => {
    const t = newTag.trim()
    if (!t) return
    const [k, ...rest] = t.split(':')
    const tag = rest.length ? { k: k.trim(), v: rest.join(':').trim(), source: 'manual' } : { k: 'tag', v: k.trim(), source: 'manual' }
    setNewTag('')
    saveTags([...tags, tag])
  }
  const removeTag = (i) => saveTags(tags.filter((_, j) => j !== i))

  const rollback = async (v) => { setBusy(true); try { await api.rollback(doc.id, v); await reload() } finally { setBusy(false) } }
  const reprocess = async () => { setBusy(true); try { await api.reprocess(doc.id); await reload() } finally { setBusy(false) } }

  const startEdit = () => {
    setForm({
      type: doc.type || '', vendor: doc.vendor || '', client: doc.client || '',
      invoiceNumber: doc.invoiceNumber || '', date: doc.date || '', amount: doc.amount ?? '',
      currency: doc.currency || 'INR', department: doc.department || '', retention: doc.retention || '',
    })
    setEditing(true)
  }
  const saveEdit = async () => {
    setBusy(true)
    try {
      await api.updateDocument(doc.id, {
        type: form.type, vendor: form.vendor, client: form.client, invoiceNumber: form.invoiceNumber,
        date: form.date, amount: form.amount === '' ? null : Number(form.amount), currency: form.currency,
        department: form.department, retention: form.retention, note: 'Edited attributes',
      })
      setEditing(false)
      await reload()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const sendEsign = async () => {
    setBusy(true)
    try {
      const { envelope } = await api.createEnvelope({ doc: doc.name, provider: 'DocuSign', signer: 'signer@client.com' })
      await api.sendEnvelope(envelope.id)
      await reload()
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex items-center flex-wrap gap-1 text-sm mb-3">
        <Link to="/browse" className="text-gray-500 hover:text-indigo-600">Browse</Link>
        <IconChevronRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="text-gray-500">{doc.client}</span>
        <IconChevronRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="font-medium text-gray-900 truncate max-w-[260px]">{doc.name}</span>
      </div>

      {doc.duplicate && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 mb-4">
          <IconWarning className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-rose-800">Flagged as duplicate</div>
            <div className="text-xs text-rose-700">Matches an existing document by vendor + amount + date.</div>
          </div>
        </div>
      )}

      {doc.status === 'Needs Review' && doc.reviewReason && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 mb-4">
          <IconWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-800">Needs review</div>
            <div className="text-xs text-amber-700">{doc.reviewReason}</div>
          </div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={reprocess}><IconHistory className="w-3.5 h-3.5" /> Reprocess</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <IconFile className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-900 truncate">{doc.name}</span>
              {doc.bonded && <Badge tone="brand"><IconLock className="w-3 h-3" /> Bonded</Badge>}
            </div>
            <div className="flex gap-2">
              {doc.storageKey && preview.url && (
                <>
                  <a href={preview.url} target="_blank" rel="noreferrer">
                    <Button variant="secondary" size="sm"><IconEye className="w-3.5 h-3.5" /> Open</Button>
                  </a>
                  <a href={preview.url} download={doc.name}>
                    <Button variant="secondary" size="sm"><IconDownload className="w-3.5 h-3.5" /> Download</Button>
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="bg-gray-100 min-h-[520px] flex items-center justify-center">
            {renderPreview(doc, preview)}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <StateBadge state={doc.status} />
              <Badge tone={confidenceTone(docConf)}>
                <IconBrain className="w-3 h-3" /> {Math.round(docConf * 100)}% confidence
              </Badge>
            </div>
            <Progress value={Math.round(docConf * 100)} tone={confidenceTone(docConf)} />
            {editing ? (
              <div className="mt-4 space-y-2.5 text-sm">
                <div>
                  <div className="text-[11px] text-gray-500 mb-1">Type</div>
                  <Select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} className="w-full">
                    {ALL_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-[11px] text-gray-500 mb-1">Vendor</div><Input value={form.vendor} onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Client</div><Input value={form.client} onChange={(e) => setForm((p) => ({ ...p, client: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Invoice #</div><Input value={form.invoiceNumber} onChange={(e) => setForm((p) => ({ ...p, invoiceNumber: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Date</div><Input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Amount</div><Input type="number" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Currency</div><Input value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} /></div>
                  <div><div className="text-[11px] text-gray-500 mb-1">Department</div><Input value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} /></div>
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1">Retention</div>
                    <Select value={form.retention} onChange={(e) => setForm((p) => ({ ...p, retention: e.target.value }))} className="w-full">
                      {RETENTIONS.map((r) => <option key={r}>{r}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" disabled={busy} onClick={saveEdit}><IconCheck className="w-3.5 h-3.5" /> Save</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-[11px] text-gray-500">Type</div><div className="text-gray-900">{doc.type}</div></div>
                  <div><div className="text-[11px] text-gray-500">Vendor</div><div className="text-gray-900">{doc.vendor}</div></div>
                  <div><div className="text-[11px] text-gray-500">Amount</div><div className="text-gray-900">{formatAmount(doc.amount, doc.currency)}</div></div>
                  <div><div className="text-[11px] text-gray-500">Date</div><div className="text-gray-900">{doc.date}</div></div>
                  {doc.invoiceNumber && <div><div className="text-[11px] text-gray-500">Invoice #</div><div className="text-gray-900">{doc.invoiceNumber}</div></div>}
                  <div><div className="text-[11px] text-gray-500">Retention</div><div className="text-gray-900">{doc.retention}</div></div>
                  <div><div className="text-[11px] text-gray-500">Department</div><div className="text-gray-900">{doc.department || '—'}</div></div>
                  <div><div className="text-[11px] text-gray-500">Version</div><div className="text-gray-900">v{doc.version}</div></div>
                </div>
                {(doc.channel || doc.classifier || doc.manuallyVerified) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {doc.manuallyVerified && <Badge tone="success"><IconCheck className="w-3 h-3" /> Verified</Badge>}
                    {doc.channel && <Badge tone="neutral">via {doc.channel}</Badge>}
                    {doc.classifier && <Badge tone="brand">classifier: {doc.classifier}</Badge>}
                    {doc.ocrEngine && <Badge tone="neutral">ocr: {doc.ocrEngine}</Badge>}
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  {can('upload') && (
                    <Button variant="secondary" size="sm" className="flex-1" disabled={busy} onClick={startEdit}>
                      <IconPen className="w-3.5 h-3.5" /> Edit
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" className="flex-1" disabled={busy} onClick={reprocess}>
                    <IconHistory className="w-3.5 h-3.5" /> Reprocess
                  </Button>
                  <Button variant="gradient" size="sm" className="flex-1" disabled={busy} onClick={sendEsign}>
                    <IconSignature className="w-3.5 h-3.5" /> eSign
                  </Button>
                </div>
              </>
            )}
          </Card>

          {doc.emailMeta?.from && (
            <SenderCard
              meta={doc.emailMeta}
              flagged={Boolean(doc.nonBusiness) || doc.status === 'Needs Review'}
              reason={doc.reviewReason}
            />
          )}

          <Card className="p-0 overflow-hidden">
            <div className="flex border-b border-gray-100">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`flex-1 text-sm py-2.5 font-medium transition ${
                  tab === t ? 'text-indigo-600 border-b-2 border-indigo-500 -mb-px' : 'text-gray-500 hover:text-gray-700'
                }`}>{t}</button>
              ))}
            </div>

            <div className="p-4">
              {tab === 'Metadata' && (
                <div>
                  {Object.keys(fields).length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500 mb-2">
                        <IconBrain className="w-3.5 h-3.5" /> Extracted fields (per-field confidence)
                      </div>
                      <div className="space-y-1.5">
                        {Object.entries(fields).map(([k, f]) => (
                          <div key={k} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-gray-500 w-28 shrink-0">{k}</span>
                            <span className="text-gray-900 truncate flex-1">{String(f.value)}</span>
                            <Badge tone={confidenceTone(f.confidence || 0)}>{Math.round((f.confidence || 0) * 100)}%</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500 mb-2">
                    <IconTag className="w-3.5 h-3.5" /> Tags & metadata
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t, i) => (
                      <span key={i} className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-500/20">
                        <span className="text-gray-500">{t.k}:</span> {t.v}
                        <span className={`ml-0.5 ${t.source === 'AI' ? 'text-indigo-400' : 'text-emerald-500'}`} title={`source: ${t.source}`}>{t.source === 'AI' ? '✦' : '✎'}</span>
                        <button onClick={() => removeTag(i)} disabled={busy} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-500"><IconX className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="key: value"
                      className="flex-1 text-xs rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                    <Button size="sm" variant="secondary" onClick={addTag} disabled={busy}><IconPlus className="w-3.5 h-3.5" /></Button>
                  </div>
                  <p className="mt-2 text-[10px] text-gray-400">✦ AI-extracted · ✎ manual edit — each edit creates a new version + audit event.</p>
                </div>
              )}

              {tab === 'Versions' && (
                <ul className="space-y-3">
                  {versions.map((v) => (
                    <li key={v.v} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`w-2.5 h-2.5 rounded-full ${v.current ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                        <span className="w-px flex-1 bg-gray-200" />
                      </div>
                      <div className="pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">v{v.v}</span>
                          {v.current && <Badge tone="brand">current</Badge>}
                        </div>
                        <div className="text-xs text-gray-600">{v.note}</div>
                        <div className="text-[11px] text-gray-400">{v.author} · {new Date(v.ts).toLocaleString()}</div>
                        {!v.current && (
                          <button onClick={() => rollback(v.v)} disabled={busy} className="mt-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
                            <IconHistory className="w-3 h-3" /> Roll back to this version
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {tab === 'Audit' && (
                <ul className="space-y-3">
                  {audit.length === 0 && <li className="text-xs text-gray-500">No audit events recorded yet.</li>}
                  {audit.map((a) => (
                    <li key={a.id} className="flex gap-2.5">
                      <span className="mt-0.5 p-1 rounded-md bg-gray-100 text-gray-500"><IconCheck className="w-3 h-3" /></span>
                      <div>
                        <div className="text-sm text-gray-800"><span className="font-medium capitalize">{a.action}</span> by {a.user}</div>
                        <div className="text-[11px] text-gray-500">{a.detail}</div>
                        <div className="text-[10px] text-gray-400">{new Date(a.ts).toLocaleString()} · {a.ip}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// Map a filename to a preview kind.
function kindForName(name = '') {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet'
  if (ext === 'docx') return 'word'
  if (['txt', 'json', 'xml', 'md', 'log', 'html', 'yaml', 'yml', 'js', 'ts', 'css'].includes(ext)) return 'text'
  return 'other'
}

const KIND_LABEL = {
  sheet: 'Spreadsheet', word: 'Word document', other: 'This file type',
}

// Renders the ORIGINAL uploaded file inline by type, with a metadata fallback
// card for seed/demo documents that have no stored file.
function renderPreview(doc, preview) {
  if (!doc.storageKey) {
    return (
      <div className="p-8 w-full flex items-center justify-center">
        <div className="w-full max-w-md bg-white shadow-lg rounded-lg aspect-[1/1.3] p-8 flex flex-col">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <div className="text-lg font-bold text-gray-900">{doc.vendor}</div>
              <div className="text-[11px] text-gray-500">GSTIN: {doc.gstin}</div>
            </div>
            <Badge tone="neutral">{doc.type}</Badge>
          </div>
          <div className="mt-6 space-y-2 text-sm text-gray-600">
            <div className="flex justify-between"><span>Date</span><span className="text-gray-900">{doc.date}</span></div>
            <div className="flex justify-between"><span>Client</span><span className="text-gray-900">{doc.client}</span></div>
            <div className="flex justify-between"><span>Category</span><span className="text-gray-900">{doc.category}</span></div>
          </div>
          <div className="mt-auto border-t pt-4 flex justify-between items-end">
            <span className="text-xs text-gray-400">No original file (sample document)</span>
            <span className="text-2xl font-bold text-gray-900">{formatAmount(doc.amount, doc.currency)}</span>
          </div>
        </div>
      </div>
    )
  }

  if (preview.loading) return <Loading label="Loading document…" />
  if (preview.error) return <div className="p-10 text-sm text-gray-500">Couldn't load the original file.</div>

  if (preview.kind === 'pdf') {
    return <iframe title={doc.name} src={preview.url} className="w-full h-[600px] border-0 bg-white" />
  }
  if (preview.kind === 'image') {
    return (
      <div className="p-6 w-full flex items-center justify-center">
        <img alt={doc.name} src={preview.url} className="max-h-[560px] max-w-full object-contain rounded shadow" />
      </div>
    )
  }
  if (preview.kind === 'text') {
    return (
      <pre className="w-full h-[600px] overflow-auto bg-white text-xs text-gray-800 p-5 font-mono whitespace-pre-wrap">
        {preview.text}
      </pre>
    )
  }
  if (preview.kind === 'sheet' || preview.kind === 'word') {
    return (
      <div className="w-full h-[600px] overflow-auto bg-white">
        {preview.kind === 'sheet' && preview.sheetNames?.length > 1 && (
          <div className="px-4 pt-3 text-[11px] text-gray-500">
            Sheets: {preview.sheetNames.join(', ')} (showing first)
          </div>
        )}
        <div
          className={`fs-doc-preview p-5 text-sm text-gray-800 ${preview.kind === 'sheet' ? 'fs-sheet' : ''}`}
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      </div>
    )
  }
  // other (rar/zip/ppt/doc/exe/media/etc.) — can't render inline.
  return (
    <div className="p-10 text-center">
      <IconFile className="w-12 h-12 text-gray-300 mx-auto" />
      <div className="mt-3 text-sm font-medium text-gray-700">{KIND_LABEL.other} can’t be previewed in the browser</div>
      <div className="mt-1 text-xs text-gray-500">{doc.name}</div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <a href={preview.url} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm"><IconEye className="w-3.5 h-3.5" /> Open</Button>
        </a>
        <a href={preview.url} download={doc.name}>
          <Button size="sm"><IconDownload className="w-3.5 h-3.5" /> Download</Button>
        </a>
      </div>
    </div>
  )
}
