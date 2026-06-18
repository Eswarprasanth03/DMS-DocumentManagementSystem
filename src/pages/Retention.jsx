import { useState } from 'react'
import { Card, PageHeader, Badge, Button, Stat, Select, Input, Loading, ErrorState } from '../components/ui.jsx'
import { IconClock, IconLock, IconCheck, IconWarning, IconSearch } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'

const RULE_LABELS = { '3yr': '3 years', '5yr': '5 years', '7yr': '7 years', '8yr': '8 years', 'active+3yr': 'Active + 3 years', permanent: 'Permanent' }

function expiryTone(item) {
  if (item.status === 'Permanent') return 'brand'
  if (item.status === 'Expired') return 'error'
  if (item.expiresInDays != null && item.expiresInDays <= 30) return 'error'
  if (item.expiresInDays != null && item.expiresInDays <= 90) return 'warning'
  return 'success'
}

export default function Retention() {
  const { data, loading, error, reload } = useApi(() => api.retention(), [])
  const [filter, setFilter] = useState('All')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)

  if (loading) return <Loading label="Loading retention…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const all = data.items
  const expiring = all.filter((r) => r.status === 'Expiring').length
  const expired = all.filter((r) => r.status === 'Expired').length
  const permanent = all.filter((r) => r.status === 'Permanent').length

  const term = q.trim().toLowerCase()
  const items = all.filter((r) => {
    if (filter === 'Expiring' && r.status !== 'Expiring') return false
    if (filter === 'Expired' && r.status !== 'Expired') return false
    if (filter === 'Permanent' && r.status !== 'Permanent') return false
    if (filter === 'Active' && r.status !== 'Active') return false
    if (term) {
      const hay = `${r.name} ${r.client} ${r.rule} ${RULE_LABELS[r.rule] || ''} ${r.status}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    return true
  })

  const act = async (id, action) => {
    setBusy(id + action)
    try { await api.retentionAction(id, action); await reload() }
    catch (e) { alert(e.message) }
    finally { setBusy(null) }
  }
  const sweep = async () => { setBusy('sweep'); try { await api.retentionSweep(); await reload() } finally { setBusy(null) } }

  return (
    <div>
      <PageHeader title="Retention & Lifecycle"
        subtitle="6 rule types with a scheduler, T-90 / T-30 escalation, archive-to-cold-storage and tombstones."
        actions={<Button variant="secondary" disabled={busy === 'sweep'} onClick={sweep}><IconClock className="w-4 h-4" /> Run sweep</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Stat label="Expiring ≤90d" value={String(expiring)} hint="escalation active" tone="warning" icon={<IconClock className="w-5 h-5" />} />
        <Stat label="Expired (action req.)" value={String(expired)} hint="archive / extend / delete" tone="error" icon={<IconWarning className="w-5 h-5" />} />
        <Stat label="Permanent / bonded" value={String(permanent)} hint="locked from deletion" tone="brand" icon={<IconLock className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="p-4 h-fit lg:col-span-1">
          <div className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 mb-2">Rule types</div>
          <ul className="space-y-1.5">
            {Object.entries(RULE_LABELS).map(([code, label]) => (
              <li key={code} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{label}</span>
                <Badge tone={code === 'permanent' ? 'brand' : 'neutral'}>{code}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-gray-400">Auto-assigned at classification time based on document type.</p>
        </Card>

        <Card className="p-0 overflow-hidden lg:col-span-3">
          <div className="px-5 py-3 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 shrink-0">Lifecycle dashboard</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <IconSearch className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, clients…" className="pl-8 py-1.5 w-56" />
              </div>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
                {['All', 'Active', 'Expiring', 'Expired', 'Permanent'].map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                  <th className="px-5 py-2 font-semibold">Document</th>
                  <th className="py-2 font-semibold">Client</th>
                  <th className="py-2 font-semibold">Rule</th>
                  <th className="py-2 font-semibold">Expires</th>
                  <th className="px-5 py-2 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No documents match.</td></tr>
                )}
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-800 truncate max-w-[220px]">{r.name}</td>
                    <td className="py-3 text-gray-600">{r.client}</td>
                    <td className="py-3"><Badge tone="neutral">{RULE_LABELS[r.rule] || r.rule}</Badge></td>
                    <td className="py-3">
                      {r.status === 'Permanent' ? (
                        <Badge tone="brand"><IconLock className="w-3 h-3" /> permanent</Badge>
                      ) : (
                        <Badge tone={expiryTone(r)}>{r.expiresInDays < 0 ? `expired ${-r.expiresInDays}d ago` : `in ${r.expiresInDays}d`}</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.status === 'Permanent' ? (
                        <span className="text-[11px] text-gray-400">locked</span>
                      ) : r.status === 'Expired' ? (
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" variant="secondary" disabled={busy === r.id + 'extend'} onClick={() => act(r.id, 'extend')}>Extend</Button>
                          <Button size="sm" variant="secondary" disabled={busy === r.id + 'archive'} onClick={() => act(r.id, 'archive')}>Archive</Button>
                          <Button size="sm" variant="danger" disabled={busy === r.id + 'delete'} onClick={() => act(r.id, 'delete')}>Delete</Button>
                        </div>
                      ) : r.status === 'Archived' ? (
                        <Badge tone="neutral">archived</Badge>
                      ) : (
                        <Badge tone="success"><IconCheck className="w-3 h-3" /> active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
