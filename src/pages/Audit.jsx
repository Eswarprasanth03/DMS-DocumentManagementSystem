import { useState } from 'react'
import { Card, PageHeader, Badge, Button, Input, Select, Loading, ErrorState } from '../components/ui.jsx'
import { toneForState } from '../lib/theme.js'
import { IconHistory, IconSearch, IconCheck, IconWarning } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'

const ACTION_TONE = { upload: 'info', view: 'neutral', edit: 'warning', delete: 'error', classify: 'brand', dedup: 'warning', share: 'info', login: 'neutral', review: 'success' }
const ACTIONS = ['All', 'upload', 'view', 'edit', 'delete', 'classify', 'dedup', 'review', 'share', 'login']

export default function Audit() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('All')
  const { data, loading, error, reload } = useApi(() => api.audit({ q, action }), [q, action])
  const { data: integrity } = useApi(() => api.auditVerify(), [])

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Immutable, hash-chained log of every action with user, timestamp, IP and before/after."
        actions={integrity && (
          integrity.valid
            ? <Badge tone="success"><IconCheck className="w-3.5 h-3.5" /> Chain verified ({integrity.count})</Badge>
            : <Badge tone="error"><IconWarning className="w-3.5 h-3.5" /> Tampering detected</Badge>
        )} />

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <IconSearch className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by user, document, or detail…" className="pl-9" />
          </div>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </Select>
        </div>
      </Card>

      {loading ? <Loading label="Loading audit log…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                  <th className="px-5 py-2.5 font-semibold">Timestamp</th>
                  <th className="py-2.5 font-semibold">User</th>
                  <th className="py-2.5 font-semibold">Action</th>
                  <th className="py-2.5 font-semibold">Document</th>
                  <th className="py-2.5 font-semibold">Detail</th>
                  <th className="px-5 py-2.5 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.audit.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap font-mono text-[12px]">{new Date(a.ts).toLocaleString()}</td>
                    <td className="py-3 text-gray-800">{a.user}</td>
                    <td className="py-3"><Badge tone={ACTION_TONE[a.action] || toneForState(a.action)}>{a.action}</Badge></td>
                    <td className="py-3 text-gray-700 truncate max-w-[200px]">{a.doc || '—'}</td>
                    <td className="py-3 text-gray-500">{a.detail}</td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-[12px]">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 text-[11px] text-gray-400">
            <IconHistory className="w-3.5 h-3.5" /> Append-only · hash-chained · {data.audit.length} of {data.total} events shown
          </div>
        </Card>
      )}
    </div>
  )
}
