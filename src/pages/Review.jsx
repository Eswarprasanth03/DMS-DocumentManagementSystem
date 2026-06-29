import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, Button, EmptyState, Input, Select, Loading, ErrorState, Progress } from '../components/ui.jsx'
import { confidenceTone } from '../lib/theme.js'
import { IconFile, IconCheck, IconX, IconHistory, IconWarning, IconBrain, IconDocCheck } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount, relTime } from '../lib/format.js'

const DOC_TYPES = [
  'Invoice', 'GST Invoice', 'Receipt', 'Travel Bill', 'Hotel Invoice', 'Fuel Bill',
  'Taxi Receipt', 'Meal Bill', 'Purchase Order', 'Goods Receipt', 'Bank Statement', 'GST Return',
  'Contract', 'MSA', 'NDA', 'Offer Letter', 'Experience Letter', 'HR Document',
  'Compliance Document', 'Miscellaneous',
]
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']

const empty = (v) => v == null || v === '' || v === 'Unknown'

// Field definitions. `core` fields are stored as top-level document attributes;
// everything else is stored in the document's `custom` bag.
const FIELD_DEFS = {
  vendor: { label: 'Vendor', core: true },
  client: { label: 'Client', core: true },
  invoiceNumber: { label: 'Invoice number', core: true },
  date: { label: 'Date', type: 'date', core: true },
  amount: { label: 'Amount', type: 'number', core: true },
  currency: { label: 'Currency', type: 'select', options: CURRENCIES, core: true },
  gstin: { label: 'GSTIN', core: true },
  department: { label: 'Department', core: true },
  // custom (type-specific)
  bankName: { label: 'Bank name' },
  accountNumber: { label: 'Account number' },
  period: { label: 'Statement / return period' },
  closingBalance: { label: 'Closing balance', type: 'number' },
  parties: { label: 'Parties', full: true },
  effectiveDate: { label: 'Effective date', type: 'date' },
  expiryDate: { label: 'Expiry date', type: 'date' },
  employeeName: { label: 'Employee name' },
  position: { label: 'Position / designation' },
  salary: { label: 'Salary / CTC', type: 'number' },
  joiningDate: { label: 'Joining date', type: 'date' },
  docTitle: { label: 'Document title' },
  issuer: { label: 'Issuer / authority' },
  validTill: { label: 'Valid till', type: 'date' },
}

// Which fields to show for each document type. Entries are field keys, or
// [key, labelOverride] to relabel a shared core field (e.g. PO/GRN number).
const TYPE_FIELDS = {
  Invoice: ['vendor', 'client', 'invoiceNumber', 'date', 'amount', 'currency', 'gstin'],
  'GST Invoice': ['vendor', 'client', 'invoiceNumber', 'date', 'amount', 'currency', 'gstin'],
  Receipt: ['vendor', 'date', 'amount', 'currency'],
  'Travel Bill': ['vendor', 'date', 'amount', 'currency'],
  'Hotel Invoice': ['vendor', 'date', 'amount', 'currency'],
  'Fuel Bill': ['vendor', 'date', 'amount', 'currency'],
  'Taxi Receipt': ['vendor', 'date', 'amount', 'currency'],
  'Meal Bill': ['vendor', 'date', 'amount', 'currency'],
  'Purchase Order': ['vendor', 'client', ['invoiceNumber', 'PO number'], 'date', 'amount', 'currency'],
  'Goods Receipt': ['vendor', ['invoiceNumber', 'GRN number'], 'date'],
  'Bank Statement': ['bankName', 'accountNumber', 'period', 'closingBalance', 'currency'],
  'GST Return': ['gstin', 'period'],
  Contract: ['parties', 'effectiveDate', 'expiryDate'],
  MSA: ['parties', 'effectiveDate', 'expiryDate'],
  NDA: ['parties', 'effectiveDate', 'expiryDate'],
  'Offer Letter': ['employeeName', 'position', 'salary', 'joiningDate'],
  'Experience Letter': ['employeeName', 'position', 'joiningDate'],
  'HR Document': ['employeeName', 'department'],
  'Compliance Document': ['docTitle', 'issuer', 'validTill'],
  Miscellaneous: ['vendor', 'date', 'amount', 'currency'],
}

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
  const [type, setType] = useState('')
  const [vals, setVals] = useState({})
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    setType(doc.type || '')
    // Seed every known field from the document's top-level value, its custom bag,
    // or the AI-extracted structured fields — whichever is present.
    const seed = {}
    for (const key of Object.keys(FIELD_DEFS)) {
      const fromDoc = doc[key]
      const fromCustom = doc.custom?.[key]
      const fromFields = doc.fields?.[key]?.value
      const v = fromDoc ?? fromCustom ?? fromFields
      seed[key] = v == null ? '' : v
    }
    if (!seed.currency) seed.currency = 'INR'
    setVals(seed)
    setTags((doc.tags || []).map((t) => `${t.k}:${t.v}`).join(', '))
  }, [doc.id])

  const set = (k) => (e) => setVals((p) => ({ ...p, [k]: e.target.value }))
  const fieldClass = (v) => `${empty(v) ? 'border-rose-300 bg-rose-50' : ''}`

  // Resolve the field list for the current type.
  const entries = (TYPE_FIELDS[type] || TYPE_FIELDS.Miscellaneous).map((e) =>
    Array.isArray(e) ? { key: e[0], label: e[1] } : { key: e, label: FIELD_DEFS[e]?.label || e },
  )

  const save = async () => {
    setBusy('save')
    try {
      // Split values into core attributes and a custom bag (type-specific).
      const payload = { type }
      const custom = { ...(doc.custom || {}) }
      for (const { key } of entries) {
        const def = FIELD_DEFS[key] || {}
        let v = vals[key]
        if (def.type === 'number') v = v === '' || v == null ? null : Number(v)
        if (def.core) payload[key] = v
        else custom[key] = v
      }
      payload.custom = custom
      await api.correctDocument(doc.id, payload)
      onDone()
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }
  const reprocess = async () => { setBusy('re'); try { await api.reprocess(doc.id); onDone() } finally { setBusy(null) } }
  const reject = async () => {
    if (!window.confirm(`Reject "${doc.name}"? It will be moved to Trash (recoverable for 30 days; admins can delete it forever).`)) return
    setBusy('rej')
    try { await api.rejectDocument(doc.id, 'Rejected in review'); onDone() } finally { setBusy(null) }
  }

  const conf = Math.round((doc.documentConfidence ?? doc.confidence ?? 0) * 100)
  const Label = ({ children, v }) => (
    <label className="block text-[11px] font-medium text-gray-600 mb-1">
      {children} {empty(v) && <span className="text-rose-500">• needs input</span>}
    </label>
  )

  const renderField = ({ key, label }) => {
    const def = FIELD_DEFS[key] || {}
    const v = vals[key] ?? ''
    const full = def.full
    return (
      <div key={key} className={full ? 'col-span-2' : ''}>
        <Label v={v}>{label}</Label>
        {def.type === 'select' ? (
          <Select value={v} onChange={set(key)} className="w-full">
            {(def.options || []).map((o) => <option key={o}>{o}</option>)}
          </Select>
        ) : (
          <Input type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'} value={v} onChange={set(key)} className={fieldClass(v)} />
        )}
      </div>
    )
  }

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
      {doc.emailMeta?.from && (
        <div className="flex items-center gap-2 text-[11px] bg-rose-50 text-rose-700 rounded-lg px-2.5 py-1.5">
          <IconWarning className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-0 truncate">
            Emailed by <span className="font-medium">{doc.emailMeta.fromName || doc.emailMeta.from}</span>
            {doc.emailMeta.fromName && <span className="text-rose-500"> &lt;{doc.emailMeta.from}&gt;</span>}
          </span>
          <a href={`mailto:${doc.emailMeta.from}`} className="font-medium underline shrink-0">Contact</a>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label v={type}>Document type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)} className={`w-full ${fieldClass(type)}`}>
            <option value="">— select —</option>
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        {/* Fields adapt to the selected document type */}
        {entries.map(renderField)}
        <div className="col-span-2"><Label>Tags (key:value, comma-separated)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="flex-1" disabled={busy === 'save'} onClick={save}><IconCheck className="w-3.5 h-3.5" /> Save & verify</Button>
        <Button size="sm" variant="secondary" disabled={busy === 're'} onClick={reprocess} title="Re-run AI"><IconHistory className="w-3.5 h-3.5" /></Button>
        <Button size="sm" variant="danger" disabled={busy === 'rej'} onClick={reject} title="Reject → move to Trash"><IconX className="w-3.5 h-3.5" /></Button>
      </div>
      <p className="text-[10px] text-gray-400">Fields adapt to the selected type. Saving marks the document Manually Verified and records the change in the audit trail.</p>
    </div>
  )
}

export default function Review() {
  const { data, loading, error, reload } = useApi(() => api.reviewQueue(), [])
  const [selId, setSelId] = useState(null)
  const [sort, setSort] = useState('latest')

  if (loading) return <Loading label="Loading review queue…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const raw = data.documents || []
  const conf = (d) => d.documentConfidence ?? d.confidence ?? 0
  const time = (d) => new Date(d.createdAt || d.updatedAt || 0).getTime()
  const items = [...raw].sort((a, b) => {
    if (sort === 'latest') return time(b) - time(a)
    if (sort === 'oldest') return time(a) - time(b)
    if (sort === 'confidence') return conf(a) - conf(b)
    if (sort === 'type') return String(a.type || '').localeCompare(String(b.type || '')) || String(a.name || '').localeCompare(String(b.name || ''))
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
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
            <div className="px-2 py-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-500">Needs review ({items.length})</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="py-1 text-[11px]" title="Sort">
                <option value="latest">Latest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
                <option value="confidence">Lowest confidence</option>
                <option value="type">Type</option>
              </Select>
            </div>
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
                      <div className="text-[10px] text-gray-400 mt-0.5 truncate">{d.type} · {Math.round((d.documentConfidence ?? d.confidence ?? 0) * 100)}%{(d.createdAt || d.updatedAt) ? ` · ${relTime(d.createdAt || d.updatedAt)}` : ''}</div>
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
