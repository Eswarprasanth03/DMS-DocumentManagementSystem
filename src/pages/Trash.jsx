import { Fragment, useState } from 'react'
import { Card, PageHeader, Badge, Button, EmptyState, Input, Loading, ErrorState } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { IconFile, IconHistory, IconX, IconWarning } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

const CONFIRM = 'PERMANENTLY DELETE'

export default function Trash() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useApi(() => api.trash(), [])
  const [busy, setBusy] = useState(null)
  const [purgeId, setPurgeId] = useState(null)
  const [confirmText, setConfirmText] = useState('')

  if (loading) return <Loading label="Loading trash…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  const items = data.items || []

  const restore = async (id) => { setBusy(id); try { await api.restoreDocument(id); reload() } catch (e) { alert(e.message) } finally { setBusy(null) } }
  const purge = async (id) => {
    setBusy(id)
    try { await api.purgeDocument(id, confirmText); setPurgeId(null); setConfirmText(''); reload() }
    catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHeader title="Trash" subtitle="Soft-deleted documents are recoverable for 30 days, then auto-purged. Permanent deletion is Admin-only."
        actions={<Badge tone="neutral">{items.length} in trash</Badge>} />

      {items.length === 0 ? (
        <Card><EmptyState icon={<IconHistory className="w-12 h-12" />} title="Trash is empty" hint="Deleted documents appear here with a 30-day recovery window." /></Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                <th className="px-5 py-2.5 font-semibold">Document</th>
                <th className="py-2.5 font-semibold">Reason</th>
                <th className="py-2.5 font-semibold">Deleted by</th>
                <th className="py-2.5 font-semibold">Recovery</th>
                <th className="px-5 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((d) => (
                <Fragment key={d.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 text-gray-800">
                        <IconFile className="w-4 h-4 text-gray-400" />
                        <span className="truncate max-w-[240px]">{d.name}</span>
                      </div>
                      <div className="text-[11px] text-gray-400">{d.vendor} · {formatAmount(d.amount, d.currency)}</div>
                    </td>
                    <td className="py-3"><Badge tone="neutral">{d.deleteReason || '—'}</Badge></td>
                    <td className="py-3 text-gray-600">{d.deletedBy || '—'}</td>
                    <td className="py-3">
                      <Badge tone={d.daysLeft <= 5 ? 'error' : d.daysLeft <= 14 ? 'warning' : 'success'}>{d.daysLeft}d left</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" variant="secondary" disabled={busy === d.id} onClick={() => restore(d.id)}><IconHistory className="w-3.5 h-3.5" /> Restore</Button>
                        {user.role === 'Admin' && (
                          <Button size="sm" variant="danger" onClick={() => { setPurgeId(purgeId === d.id ? null : d.id); setConfirmText('') }}>
                            <IconX className="w-3.5 h-3.5" /> Delete forever
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {purgeId === d.id && (
                    <tr className="bg-rose-50">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <span className="text-xs text-rose-700 flex items-center gap-1.5">
                            <IconWarning className="w-4 h-4" /> This cannot be undone. Type <code className="font-mono font-semibold">{CONFIRM}</code> to confirm:
                          </span>
                          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM} className="sm:w-56" />
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => { setPurgeId(null); setConfirmText('') }}>Cancel</Button>
                            <Button size="sm" variant="danger" disabled={confirmText !== CONFIRM || busy === d.id} onClick={() => purge(d.id)}>Permanently delete</Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
