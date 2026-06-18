import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, Button, EmptyState, Select, Loading, ErrorState } from '../components/ui.jsx'
import { IconFile, IconCheck, IconX, IconWarning, IconLock } from '../components/icons.jsx'
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

function Pair({ pair, onChange }) {
  const { duplicate, original, diff } = pair
  const [reason, setReason] = useState('Duplicate')
  const [busy, setBusy] = useState(null)

  const dismiss = async () => { setBusy('d'); try { await api.dismissDuplicate(duplicate.id); onChange() } catch (e) { alert(e.message) } finally { setBusy(null) } }
  const merge = async () => { setBusy('m'); try { await api.mergeDuplicate(original.id, duplicate.id); onChange() } catch (e) { alert(e.message) } finally { setBusy(null) } }
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

      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
        <Badge tone="warning"><IconWarning className="w-3 h-3" /> {diff.length} field{diff.length !== 1 ? 's' : ''} differ</Badge>
        <span className="text-[11px] text-gray-400">Keep the original, act on the duplicate →</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy === 'd'} onClick={dismiss}>Not a duplicate</Button>
          {original && <Button size="sm" variant="secondary" disabled={busy === 'm'} onClick={merge}><IconCheck className="w-3.5 h-3.5" /> Merge → keep original</Button>}
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="py-1.5">
            {DELETE_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
          <Button size="sm" variant="danger" disabled={busy === 'x'} onClick={del}><IconX className="w-3.5 h-3.5" /> Delete duplicate</Button>
        </div>
      </div>
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
