import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, Button, EmptyState, Progress, Select, Loading, ErrorState } from '../components/ui.jsx'
import { confidenceTone } from '../lib/theme.js'
import { IconBrain, IconFile, IconCheck, IconDocCheck, IconWarning, IconX, IconHistory } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

const DOC_TYPES = [
  'Invoice', 'GST Invoice', 'Receipt', 'Travel Bill', 'Hotel Invoice', 'Fuel Bill',
  'Taxi Receipt', 'Meal Bill', 'Purchase Order', 'Bank Statement', 'GST Return',
  'Contract', 'MSA', 'NDA', 'Offer Letter', 'Experience Letter', 'HR Document',
  'Compliance Document', 'Miscellaneous',
]

export default function Review() {
  const { data, loading, error, reload } = useApi(() => api.reviewQueue(), [])
  const [busy, setBusy] = useState(null)
  const [picked, setPicked] = useState({})

  if (loading) return <Loading label="Loading review queue…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const items = data.documents || []

  const approve = async (d) => {
    setBusy(d.id + 'a')
    try { await api.approveDocument(d.id, picked[d.id] ? { type: picked[d.id] } : {}); await reload() } finally { setBusy(null) }
  }
  const reject = async (d) => {
    setBusy(d.id + 'r')
    try { await api.rejectDocument(d.id, 'Rejected by reviewer'); await reload() } finally { setBusy(null) }
  }
  const reprocess = async (d) => {
    setBusy(d.id + 'p')
    try { await api.reprocess(d.id); await reload() } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHeader title="Doc Review" subtitle="Low-confidence or failed-validation documents land here for a human to confirm, correct, or reject."
        actions={<Badge tone="warning">{items.length} awaiting review</Badge>} />

      {items.length === 0 ? (
        <Card><EmptyState icon={<IconDocCheck className="w-12 h-12" />} title="Review queue is clear" hint="Every document passed classification + validation above the confidence threshold." /></Card>
      ) : (
        <div className="space-y-3">
          {items.map((d) => {
            const conf = Math.round((d.documentConfidence ?? d.confidence ?? 0) * 100)
            const fields = d.fields || {}
            return (
              <Card key={d.id} className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  <Link to={`/document/${d.id}`} className="flex items-center gap-3 min-w-0 lg:w-72">
                    <span className="p-2 rounded-lg bg-gray-50 text-gray-500"><IconFile className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{d.name}</div>
                      <div className="text-[11px] text-gray-500">{d.type} · {d.vendor} · {formatAmount(d.amount, d.currency)}</div>
                    </div>
                  </Link>

                  <div className="flex-1 min-w-0">
                    {d.reviewReason && (
                      <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                        <IconWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {d.reviewReason}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-gray-500 flex items-center gap-1"><IconBrain className="w-3 h-3" /> confidence</span>
                      <Progress value={conf} tone={confidenceTone((d.documentConfidence ?? d.confidence) || 0)} className="w-32" />
                      <span className="text-[11px] font-medium text-gray-700">{conf}%</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(fields).slice(0, 8).map(([k, f]) => (
                        <Badge key={k} tone={f.confidence >= 0.75 ? 'success' : 'warning'}>
                          {k}: {String(f.value).slice(0, 18)} · {Math.round((f.confidence || 0) * 100)}%
                        </Badge>
                      ))}
                      {Object.keys(fields).length === 0 && <span className="text-[11px] text-gray-400">No fields extracted</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:w-44">
                    <Select defaultValue={d.type} onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.value }))} className="w-full">
                      {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </Select>
                    <div className="flex gap-1.5">
                      <Button size="sm" className="flex-1" disabled={busy === d.id + 'a'} onClick={() => approve(d)}><IconCheck className="w-3.5 h-3.5" /> Approve</Button>
                      <Button size="sm" variant="secondary" disabled={busy === d.id + 'p'} onClick={() => reprocess(d)} title="Re-run AI"><IconHistory className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="danger" disabled={busy === d.id + 'r'} onClick={() => reject(d)} title="Reject"><IconX className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
