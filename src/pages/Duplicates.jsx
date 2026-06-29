import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, Button, EmptyState, Select, Loading, ErrorState } from '../components/ui.jsx'
import { IconFile, IconCheck, IconX, IconWarning, IconLock, IconEye, IconDownload } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

const ROWS = [
  ['type', 'Type'], ['vendor', 'Vendor'], ['client', 'Client'], ['invoiceNumber', 'Invoice #'],
  ['date', 'Date'], ['amount', 'Amount'], ['gstin', 'GSTIN'], ['department', 'Department'],
]
const DELETE_REASONS = ['Duplicate', 'Incorrect Upload', 'Other']

function fmt(key, v) {
  if (v == null || v === '') return '—'
  if (key === 'amount') return formatAmount(v)
  return String(v)
}

function DocColumn({ doc, diff, label, tone }) {
  return (
    <div className="flex-1 min-w-0">
      <div className={`flex items-center gap-2 mb-2 ${tone}`}>
        <IconFile className="w-4 h-4 shrink-0" />
        <Link to={`/document/${doc.id}`} className="text-sm font-medium truncate hover:underline">{doc.name}</Link>
        {doc.bonded && <IconLock className="w-3.5 h-3.5 text-indigo-500" />}
      </div>
      <table className="w-full text-xs">
        <tbody>
          {ROWS.map(([k, lbl]) => (
            <tr key={k} className={diff.includes(k) ? 'bg-amber-50' : ''}>
              <td className="py-1 pr-2 text-gray-400 w-24">{lbl}</td>
              <td className={`py-1 ${diff.includes(k) ? 'text-amber-800 font-medium' : 'text-gray-800'}`}>{fmt(k, doc[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Loads a document's ORIGINAL file and renders it inline (pdf / image / link).
function FilePreview({ doc }) {
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

  if (!doc?.storageKey) return <div className="h-full flex items-center justify-center text-xs text-gray-400 p-6 text-center">No original file (sample document)</div>
  if (state.loading) return <div className="h-full flex items-center justify-center"><Loading label="Loading…" /></div>
  if (state.error || !state.url) return <div className="h-full flex items-center justify-center text-xs text-gray-500 p-6">Couldn’t load the file.</div>
  const n = (doc.name || '').toLowerCase()
  if (n.endsWith('.pdf')) return <iframe title={doc.name} src={state.url} className="w-full h-full border-0 bg-white" />
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return <div className="h-full overflow-auto p-3 flex items-start justify-center"><img alt={doc.name} src={state.url} className="max-w-full object-contain" /></div>
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-500 p-6">
      <IconFile className="w-10 h-10 text-gray-300" />
      <span>Can’t preview this type inline</span>
      <a href={state.url} download={doc.name}><Button size="sm" variant="secondary"><IconDownload className="w-3.5 h-3.5" /> Download</Button></a>
    </div>
  )
}

// Full-screen side-by-side comparison of the two actual document files.
function CompareModal({ original, duplicate, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-6xl h-[88vh] p-0 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Compare documents</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><IconX className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 divide-x divide-gray-100">
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-emerald-700">
              <IconFile className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium truncate">Original · {original?.name || '—'}</span>
            </div>
            <div className="flex-1 min-h-0 bg-gray-100">
              {original ? <FilePreview doc={original} /> : <div className="h-full flex items-center justify-center text-xs text-gray-400">Original not available.</div>}
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-rose-700">
              <IconFile className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium truncate">Duplicate · {duplicate?.name || '—'}</span>
            </div>
            <div className="flex-1 min-h-0 bg-gray-100">
              <FilePreview doc={duplicate} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Pair({ pair, onChange }) {
  const { duplicate, original, diff } = pair
  const [reason, setReason] = useState('Duplicate')
  const [busy, setBusy] = useState(null)
  const [comparing, setComparing] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)

  const dismiss = async () => { setBusy('d'); try { await api.dismissDuplicate(duplicate.id); onChange() } catch (e) { alert(e.message) } finally { setBusy(null) } }
  // Merge keeping the chosen document; the other is merged in and soft-deleted.
  const mergeKeep = async (keep) => {
    const targetId = keep === 'duplicate' ? duplicate.id : original.id
    const sourceId = keep === 'duplicate' ? original.id : duplicate.id
    setBusy('m')
    try { await api.mergeDuplicate(targetId, sourceId); onChange() } catch (e) { alert(e.message) } finally { setBusy(null) }
  }
  const del = async () => { setBusy('x'); try { await api.softDelete(duplicate.id, reason, original?.id); onChange() } catch (e) { alert(e.message) } finally { setBusy(null) } }

  return (
    <Card className="p-5">
      <div className="flex flex-col md:flex-row gap-5">
        {original
          ? <DocColumn doc={original} diff={diff} tone="text-emerald-700" />
          : <div className="flex-1 text-xs text-gray-400">Original not available (deleted/removed).</div>}
        <div className="hidden md:flex items-center text-gray-300 font-semibold">vs</div>
        <DocColumn doc={duplicate} diff={diff} tone="text-rose-700" />
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100">
        {mergeMode ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand"><IconCheck className="w-3 h-3" /> Merge — which document should be kept?</Badge>
            <span className="text-[11px] text-gray-400">The other is merged into it and moved to Trash.</span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" disabled={busy === 'm'} onClick={() => mergeKeep('original')} title={original?.name}>
                <IconCheck className="w-3.5 h-3.5" /> Keep original
              </Button>
              <Button size="sm" disabled={busy === 'm'} onClick={() => mergeKeep('duplicate')} title={duplicate?.name}>
                <IconCheck className="w-3.5 h-3.5" /> Keep duplicate
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === 'm'} onClick={() => setMergeMode(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning"><IconWarning className="w-3 h-3" /> {diff.length} field{diff.length !== 1 ? 's' : ''} differ</Badge>
            <span className="text-[11px] text-gray-400">Compare, then choose what to keep →</span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setComparing(true)}><IconEye className="w-3.5 h-3.5" /> Compare</Button>
              <Button size="sm" variant="secondary" disabled={busy === 'd'} onClick={dismiss}>Not a duplicate</Button>
              {original && <Button size="sm" variant="secondary" disabled={busy === 'm'} onClick={() => setMergeMode(true)}><IconCheck className="w-3.5 h-3.5" /> Merge…</Button>}
              <Select value={reason} onChange={(e) => setReason(e.target.value)} className="py-1.5">
                {DELETE_REASONS.map((r) => <option key={r}>{r}</option>)}
              </Select>
              <Button size="sm" variant="danger" disabled={busy === 'x'} onClick={del}><IconX className="w-3.5 h-3.5" /> Delete duplicate</Button>
            </div>
          </div>
        )}
      </div>
      {comparing && <CompareModal original={original} duplicate={duplicate} onClose={() => setComparing(false)} />}
    </Card>
  )
}

export default function Duplicates() {
  const { data, loading, error, reload } = useApi(() => api.duplicates(), [])
  if (loading) return <Loading label="Loading duplicates…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  const pairs = data.pairs || []

  return (
    <div>
      <PageHeader title="Possible Duplicates" subtitle="Review flagged duplicates side-by-side. Deleting a duplicate keeps the original and is recoverable for 30 days."
        actions={<Badge tone={pairs.length ? 'error' : 'success'}>{pairs.length} pending</Badge>} />
      {pairs.length === 0 ? (
        <Card><EmptyState icon={<IconCheck className="w-12 h-12" />} title="No duplicates to review" hint="The pipeline flags potential duplicates by checksum or vendor + amount + date." /></Card>
      ) : (
        <div className="space-y-3">
          {pairs.map((p) => <Pair key={p.duplicate.id} pair={p} onChange={reload} />)}
        </div>
      )}
    </div>
  )
}
