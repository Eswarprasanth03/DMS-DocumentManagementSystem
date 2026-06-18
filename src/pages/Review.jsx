import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, Button, EmptyState, Input, Select, Loading, ErrorState, Progress } from '../components/ui.jsx'
import { confidenceTone } from '../lib/theme.js'
import { IconFile, IconCheck, IconX, IconHistory, IconWarning, IconBrain, IconDocCheck } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

const DOC_TYPES = [
  'Invoice', 'GST Invoice', 'Receipt', 'Travel Bill', 'Hotel Invoice', 'Fuel Bill',
  'Taxi Receipt', 'Meal Bill', 'Purchase Order', 'Bank Statement', 'GST Return',
  'Contract', 'MSA', 'NDA', 'Offer Letter', 'Experience Letter', 'HR Document',
  'Compliance Document', 'Miscellaneous',
]
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']

const empty = (v) => v == null || v === '' || v === 'Unknown'

function DocPreview({ doc }) {
  const [state, setState] = useState({ loading: true, url: null, error: false })
  useEffect(() => {
    if (!doc?.storageKey) { setState({ loading: false, url: null, error: false }); return undefined }
    let active = true; let url = null
    setState({ loading: true, url: null, error: false })
    api.fileObjectUrl(doc.id)
      .then((u) => { if (active) { url = u; setState({ loading: false, url: u, error: false }) } else URL.revokeObjectURL(u) })
      .catch(() => active && setState({ loading: false, url: null, error: true }))
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [doc?.id, doc?.storageKey])

  if (!doc?.storageKey) return <div className="h-full flex items-center justify-center text-xs text-gray-400 p-6">No original file for this document.</div>
  if (state.loading) return <div className="h-full flex items-center justify-center"><Loading label="Loading document…" /></div>
  if (state.error || !state.url) return <div className="h-full flex items-center justify-center text-xs text-gray-500 p-6">Couldn’t load the document.</div>
  const n = (doc.name || '').toLowerCase()
  if (n.endsWith('.pdf')) return <iframe title={doc.name} src={state.url} className="w-full h-[560px] border-0 bg-white" />
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return <div className="p-4 flex justify-center"><img alt={doc.name} src={state.url} className="max-h-[540px] max-w-full object-contain" /></div>
  return <div className="h-full flex items-center justify-center text-xs text-gray-500 p-6">Preview not available — <a className="text-indigo-600 ml-1" href={state.url} download={doc.name}>download</a></div>
}

function CorrectionForm({ doc, onDone }) {
  const [f, setF] = useState({})
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    setF({
      type: doc.type || '', vendor: doc.vendor || '', client: doc.client || '',
      invoiceNumber: doc.invoiceNumber || doc.fields?.invoiceNumber?.value || '',
      date: doc.date || '', amount: doc.amount ?? '', currency: doc.currency || 'INR',
      department: doc.department || '', tags: (doc.tags || []).map((t) => `${t.k}:${t.v}`).join(', '),
    })
  }, [doc.id])

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const fieldClass = (v) => `${empty(v) ? 'border-rose-300 bg-rose-50' : ''}`

  const save = async () => {
    setBusy('save')
    try {
      await api.correctDocument(doc.id, {
        type: f.type, vendor: f.vendor, client: f.client, invoiceNumber: f.invoiceNumber,
        date: f.date, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency,
        department: f.department,
      })
      onDone()
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }
  const reprocess = async () => { setBusy('re'); try { await api.reprocess(doc.id); onDone() } finally { setBusy(null) } }
  const reject = async () => { setBusy('rej'); try { await api.rejectDocument(doc.id, 'Rejected in review'); onDone() } finally { setBusy(null) } }

  const conf = Math.round((doc.documentConfidence ?? doc.confidence ?? 0) * 100)
  const Label = ({ children, v }) => (
    <label className="block text-[11px] font-medium text-gray-600 mb-1">
      {children} {empty(v) && <span className="text-rose-500">• needs input</span>}
    </label>
  )

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 flex items-center gap-1"><IconBrain className="w-3.5 h-3.5" /> confidence</span>
        <div className="flex items-center gap-2 flex-1 mx-3"><Progress value={conf} tone={confidenceTone((doc.documentConfidence ?? doc.confidence) || 0)} /></div>
        <span className="text-[11px] font-medium text-gray-700">{conf}%</span>
      </div>
      {doc.reviewReason && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
          <IconWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {doc.reviewReason}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label v={f.type}>Document type</Label>
          <Select value={f.type} onChange={set('type')} className={`w-full ${fieldClass(f.type)}`}>
            <option value="">— select —</option>
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        <div><Label v={f.vendor}>Vendor</Label><Input value={f.vendor} onChange={set('vendor')} className={fieldClass(f.vendor)} /></div>
        <div><Label v={f.client}>Client</Label><Input value={f.client} onChange={set('client')} className={fieldClass(f.client)} /></div>
        <div><Label v={f.invoiceNumber}>Invoice number</Label><Input value={f.invoiceNumber} onChange={set('invoiceNumber')} className={fieldClass(f.invoiceNumber)} /></div>
        <div><Label v={f.date}>Date</Label><Input type="date" value={f.date} onChange={set('date')} className={fieldClass(f.date)} /></div>
        <div><Label v={f.amount}>Amount</Label><Input type="number" value={f.amount} onChange={set('amount')} className={fieldClass(f.amount)} /></div>
        <div><Label>Currency</Label><Select value={f.currency} onChange={set('currency')} className="w-full">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div className="col-span-2"><Label v={f.department}>Department</Label><Input value={f.department} onChange={set('department')} className={fieldClass(f.department)} /></div>
        <div className="col-span-2"><Label>Tags (key:value, comma-separated)</Label><Input value={f.tags} onChange={set('tags')} /></div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="flex-1" disabled={busy === 'save'} onClick={save}><IconCheck className="w-3.5 h-3.5" /> Save & verify</Button>
        <Button size="sm" variant="secondary" disabled={busy === 're'} onClick={reprocess} title="Re-run AI"><IconHistory className="w-3.5 h-3.5" /></Button>
        <Button size="sm" variant="danger" disabled={busy === 'rej'} onClick={reject} title="Reject"><IconX className="w-3.5 h-3.5" /></Button>
      </div>
      <p className="text-[10px] text-gray-400">Saving renames the file to <code>type_vendor_invoice_date.ext</code>, marks it Manually Verified, and records the change in the audit trail.</p>
    </div>
  )
}

export default function Review() {
  const { data, loading, error, reload } = useApi(() => api.reviewQueue(), [])
  const [selId, setSelId] = useState(null)

  if (loading) return <Loading label="Loading review queue…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const items = data.documents || []
  const selected = items.find((d) => d.id === selId) || items[0] || null
  const afterAction = () => { setSelId(null); reload() }

  return (
    <div>
      <PageHeader title="Doc Review" subtitle="Correct failed/incomplete classifications side-by-side, then verify."
        actions={<Badge tone="warning">{items.length} awaiting review</Badge>} />

      {items.length === 0 ? (
        <Card><EmptyState icon={<IconDocCheck className="w-12 h-12" />} title="Review queue is clear" hint="Every document passed classification + validation." /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Queue rail */}
          <Card className="p-2 lg:col-span-3 h-fit">
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-slate-500">Needs review ({items.length})</div>
            <ul className="space-y-1 max-h-[600px] overflow-y-auto">
              {items.map((d) => {
                const active = selected && d.id === selected.id
                return (
                  <li key={d.id}>
                    <button onClick={() => setSelId(d.id)} className={`w-full text-left rounded-lg px-2.5 py-2 transition ${active ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                      <div className="flex items-center gap-2">
                        <IconFile className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-500' : 'text-gray-400'}`} />
                        <span className={`text-xs truncate ${active ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}>{d.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 truncate">{d.type} · {Math.round((d.documentConfidence ?? d.confidence ?? 0) * 100)}%</div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* Side-by-side: document preview + correction form */}
          {selected && (
            <>
              <Card className="p-0 overflow-hidden lg:col-span-5">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                  <IconFile className="w-4 h-4 text-gray-400" />
                  <Link to={`/document/${selected.id}`} className="text-sm font-medium text-gray-900 truncate hover:text-indigo-600">{selected.name}</Link>
                </div>
                <div className="bg-gray-100 min-h-[560px]"><DocPreview doc={selected} /></div>
              </Card>
              <Card className="lg:col-span-4 p-0 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-900">Correct metadata</div>
                <CorrectionForm key={selected.id} doc={selected} onDone={afterAction} />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
