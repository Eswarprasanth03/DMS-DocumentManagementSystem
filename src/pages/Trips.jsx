import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, StateBadge, Button, EmptyState, Loading, ErrorState } from '../components/ui.jsx'
import { IconMap, IconFile, IconCheck, IconX, IconClock } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

export default function Trips() {
  const { data, loading, error, reload } = useApi(() => api.trips(), [])
  const [busy, setBusy] = useState(false)

  const setStatus = async (id, status) => {
    setBusy(true)
    try { await api.updateTrip(id, status); await reload() } finally { setBusy(false) }
  }
  const runDetect = async () => {
    setBusy(true)
    try { await api.detectTrips(); await reload() } finally { setBusy(false) }
  }

  if (loading) return <Loading label="Loading trips…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const trips = data.trips

  return (
    <div>
      <PageHeader
        title="Trip Detection"
        subtitle="Taxi + hotel (+ meal) within a 72h window are auto-grouped into a trip and linked to a folder."
        actions={<Button variant="secondary" disabled={busy} onClick={runDetect}><IconMap className="w-4 h-4" /> Re-run detection</Button>}
      />

      {trips.length === 0 ? (
        <Card><EmptyState icon={<IconMap className="w-12 h-12" />} title="No trips detected" hint="Upload a taxi and a hotel bill for the same client within 72h to auto-group a trip." /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {trips.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white"><IconMap className="w-5 h-5" /></span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                    <div className="text-[11px] text-gray-500">{t.client} · {t.window}</div>
                  </div>
                </div>
                <StateBadge state={t.status} />
              </div>

              <div className="mt-4 flex items-center gap-2 text-[11px] text-gray-500">
                <IconClock className="w-3.5 h-3.5" /> detected within {t.detectedWithin}
                <span className="ml-auto flex gap-1 flex-wrap">{t.signals.map((s) => <Badge key={s} tone="brand">{s}</Badge>)}</span>
              </div>

              <div className="mt-4 rounded-lg border border-gray-100 divide-y divide-gray-50">
                {(t.docs || []).map((d) => (
                  <Link key={d.id} to={`/document/${d.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-sm">
                    <IconFile className="w-4 h-4 text-gray-400" />
                    <span className="truncate flex-1 text-gray-800">{d.name}</span>
                    <span className="text-gray-600">{formatAmount(d.amount, d.currency)}</span>
                  </Link>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-gray-500">Trip total</div>
                  <div className="text-lg font-bold text-gray-900">{formatAmount(t.total)}</div>
                </div>
                {t.status === 'Pending' ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setStatus(t.id, 'Rejected')}><IconX className="w-3.5 h-3.5" /> Not a trip</Button>
                    <Button size="sm" disabled={busy} onClick={() => setStatus(t.id, 'Acknowledged')}><IconCheck className="w-3.5 h-3.5" /> Confirm trip</Button>
                  </div>
                ) : (
                  <Badge tone={t.status === 'Rejected' ? 'error' : 'success'}>{t.status === 'Rejected' ? 'Dismissed' : 'Confirmed & linked'}</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
