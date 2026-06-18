import { Link } from 'react-router-dom'
import { Card, Stat, PageHeader, Button, Progress, StateBadge, Badge, Loading, ErrorState } from '../components/ui.jsx'
import {
  IconFile, IconUpload, IconClock, IconMap, IconBrain, IconChevronRight, IconWarning,
} from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

export default function Dashboard() {
  const { data, loading, error, reload } = useApi(async () => {
    const [stats, docs, trips, retention] = await Promise.all([
      api.stats(), api.documents(), api.trips(), api.retention(),
    ])
    return { stats, docs: docs.documents, trips: trips.trips, retention: retention.items }
  }, [])

  if (loading) return <Loading label="Loading dashboard…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const { stats, docs, trips, retention } = data
  const expiring = retention.filter((r) => r.status === 'Expiring' || r.status === 'Expired')
  const needsReview = docs.filter((d) => d.status === 'Needs Review')
  const recent = [...docs].filter((d) => !d.tombstone).slice(-5).reverse()

  const pipeline = [
    { stage: 'Captured', value: 100, tone: 'info' },
    { stage: 'OCR', value: 96, tone: 'info' },
    { stage: 'Classified', value: Math.round(stats.autoClassifiedPct), tone: 'brand' },
    { stage: 'Auto-named & filed', value: Math.max(0, Math.round(stats.autoClassifiedPct) - 4), tone: 'success' },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview of capture, classification, retention and compliance."
        actions={
          <Link to="/upload">
            <Button variant="gradient"><IconUpload className="w-4 h-4" /> Upload documents</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Documents" value={String(stats.documents)} hint={`${stats.duplicates} duplicates flagged`} tone="brand" icon={<IconFile className="w-5 h-5" />} />
        <Stat label="Auto-classified" value={`${stats.autoClassifiedPct}%`} hint={`avg confidence ${stats.avgConfidence}`} tone="success" icon={<IconBrain className="w-5 h-5" />} />
        <Stat label="Expiring / expired" value={String(stats.expiring + stats.expired)} hint="retention escalation" tone="warning" icon={<IconClock className="w-5 h-5" />} />
        <Stat label="Trips detected" value={String(stats.trips)} hint="taxi+hotel within 72h" tone="info" icon={<IconMap className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Document intelligence pipeline</h3>
            <Badge tone="success">Healthy</Badge>
          </div>
          <div className="space-y-4">
            {pipeline.map((p) => (
              <div key={p.stage}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{p.stage}</span>
                  <span className="font-medium text-gray-800">{p.value}%</span>
                </div>
                <Progress value={p.value} tone={p.tone} />
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-lg font-bold text-gray-900">{stats.needsReview}</div>
              <div className="text-[11px] text-gray-500">Needs review</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-lg font-bold text-gray-900">{stats.duplicates}</div>
              <div className="text-[11px] text-gray-500">Duplicates flagged</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-lg font-bold text-gray-900">&lt;1s</div>
              <div className="text-[11px] text-gray-500">Avg search time</div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Needs your attention</h3>
          {needsReview.length === 0 && expiring.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">Nothing needs attention. 🎉</div>
          ) : (
            <ul className="space-y-2.5">
              {needsReview.map((d) => (
                <li key={d.id}>
                  <Link to={`/document/${d.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50">
                    <span className="p-1.5 rounded-md bg-amber-50 text-amber-600"><IconWarning className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 truncate">{d.name}</div>
                      <div className="text-[11px] text-gray-500">Low confidence · {Math.round(d.confidence * 100)}%</div>
                    </div>
                    <IconChevronRight className="w-4 h-4 text-gray-300" />
                  </Link>
                </li>
              ))}
              {expiring.slice(0, 3).map((r) => (
                <li key={r.id}>
                  <Link to="/retention" className="flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50">
                    <span className="p-1.5 rounded-md bg-rose-50 text-rose-600"><IconClock className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 truncate">{r.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {r.expiresInDays < 0 ? `Expired ${-r.expiresInDays}d ago` : `Expires in ${r.expiresInDays}d`}
                      </div>
                    </div>
                    <IconChevronRight className="w-4 h-4 text-gray-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Recent documents</h3>
            <Link to="/browse" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                  <th className="py-2 font-semibold">Name</th>
                  <th className="py-2 font-semibold">Vendor</th>
                  <th className="py-2 font-semibold text-right">Amount</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="py-2.5">
                      <Link to={`/document/${d.id}`} className="flex items-center gap-2 text-gray-800 hover:text-indigo-600">
                        <IconFile className="w-4 h-4 text-gray-400" />
                        <span className="truncate max-w-[200px]">{d.name}</span>
                      </Link>
                    </td>
                    <td className="py-2.5 text-gray-600">{d.vendor}</td>
                    <td className="py-2.5 text-right text-gray-800">{formatAmount(d.amount, d.currency)}</td>
                    <td className="py-2.5"><StateBadge state={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Detected trips</h3>
            <Link to="/trips" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
          </div>
          {trips.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">No trips detected yet.</div>
          ) : (
            <ul className="space-y-3">
              {trips.map((t) => (
                <li key={t.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{t.name}</span>
                    <StateBadge state={t.status} />
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">{t.client} · {t.window}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {t.signals.map((s) => <Badge key={s} tone="brand">{s}</Badge>)}
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{formatAmount(t.total)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
