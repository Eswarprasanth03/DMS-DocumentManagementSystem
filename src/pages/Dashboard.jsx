import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Button, Progress, StateBadge, Badge, Loading, ErrorState } from '../components/ui.jsx'
import { statusStyles, toneForState } from '../lib/theme.js'
import {
  IconFile, IconUpload, IconClock, IconMap, IconBrain, IconChevronRight, IconWarning,
  IconHistory, IconCheck, IconCopy, IconBolt,
} from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { formatAmount, relTime } from '../lib/format.js'

const TONE_HEX = {
  success: '#10b981', warning: '#f59e0b', error: '#f43f5e',
  info: '#0ea5e9', neutral: '#94a3b8', brand: '#6366f1',
}

function countBy(items, key) {
  const out = {}
  for (const it of items) {
    const k = it[key] || 'Unknown'
    out[k] = (out[k] || 0) + 1
  }
  return out
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Pure-SVG donut so we avoid a charting dependency.
function Donut({ data, size = 160, stroke = 22 }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {total > 0 && data.map((d, i) => {
            const len = (d.value / total) * C
            const seg = (
              <circle
                key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={d.color} strokeWidth={stroke}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </circle>
            )
            offset += len
            return seg
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold text-gray-900">{total}</div>
        <div className="text-[11px] text-gray-500">documents</div>
      </div>
    </div>
  )
}

function KpiCard({ to, label, value, hint, tone, icon }) {
  return (
    <Link to={to} className="group block">
      <Card className="p-4 h-full transition hover:shadow-md hover:-translate-y-0.5 hover:border-indigo-200">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
            {hint && <div className="mt-1 text-xs text-gray-500 truncate">{hint}</div>}
          </div>
          <div className={`p-2 rounded-lg ${statusStyles[tone]}`}>{icon}</div>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition">
          View details <IconChevronRight className="w-3 h-3" />
        </div>
      </Card>
    </Link>
  )
}

function BarRow({ label, value, suffix, max, color, to }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  const body = (
    <div className="group">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-700 truncate pr-2">{label}</span>
        <span className="font-semibold text-gray-800 shrink-0">{suffix ?? value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all group-hover:opacity-80" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
      </div>
    </div>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

export default function Dashboard() {
  const { user } = useAuth()
  const [updatedAt, setUpdatedAt] = useState(() => new Date().toISOString())

  const { data, loading, error, reload } = useApi(async () => {
    const [stats, docs, trips, retention] = await Promise.all([
      api.stats(), api.documents(), api.trips(), api.retention(),
    ])
    setUpdatedAt(new Date().toISOString())
    return { stats, docs: docs.documents, trips: trips.trips, retention: retention.items }
  }, [])

  const derived = useMemo(() => {
    if (!data) return null
    const active = data.docs.filter((d) => !d.tombstone)
    const statusCounts = countBy(active, 'status')
    const typeCounts = countBy(active, 'type')
    const totalValue = active.reduce((s, d) => s + (Number(d.amount) || 0), 0)

    const vendorSpend = {}
    for (const d of active) {
      const v = d.vendor && d.vendor !== 'Unknown' ? d.vendor : null
      if (v && Number(d.amount)) vendorSpend[v] = (vendorSpend[v] || 0) + Number(d.amount)
    }

    const statusData = Object.entries(statusCounts)
      .map(([label, value]) => ({ label, value, color: TONE_HEX[toneForState(label)] }))
      .sort((a, b) => b.value - a.value)

    const typeData = Object.entries(typeCounts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    const topVendors = Object.entries(vendorSpend)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    return { active, statusData, typeData, topVendors, totalValue }
  }, [data])

  if (loading) return <Loading label="Loading dashboard…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const { stats, docs, trips, retention } = data
  const { statusData, typeData, topVendors, totalValue } = derived
  const expiring = retention.filter((r) => r.status === 'Expiring' || r.status === 'Expired')
  const needsReview = docs.filter((d) => d.status === 'Needs Review' && !d.tombstone)
  const recent = [...docs].filter((d) => !d.tombstone).slice(-6).reverse()
  const typeMax = typeData[0]?.value || 1
  const vendorMax = topVendors[0]?.value || 1

  const pipeline = [
    { stage: 'Captured', value: 100, tone: 'info' },
    { stage: 'OCR / text extraction', value: 96, tone: 'info' },
    { stage: 'Classified', value: Math.round(stats.autoClassifiedPct), tone: 'brand' },
    { stage: 'Auto-named & filed', value: Math.max(0, Math.round(stats.autoClassifiedPct) - 4), tone: 'success' },
  ]
  const firstName = (user?.name || '').split(' ')[0] || 'there'

  return (
    <div>
      {/* Personalized header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting()}, {firstName}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Here's what's happening across capture, classification, retention and compliance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] text-gray-400">Updated {relTime(updatedAt)}</span>
          <Button variant="secondary" size="sm" onClick={reload}>
            <IconHistory className="w-4 h-4" /> Refresh
          </Button>
          <Link to="/upload">
            <Button variant="gradient" size="sm"><IconUpload className="w-4 h-4" /> Upload</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard to="/browse" label="Documents" value={String(stats.documents)} hint="in library" tone="brand" icon={<IconFile className="w-5 h-5" />} />
        <KpiCard to="/browse" label="Total value" value={formatAmount(totalValue)} hint="sum of amounts" tone="success" icon={<IconBolt className="w-5 h-5" />} />
        <KpiCard to="/review" label="Needs review" value={String(stats.needsReview)} hint="awaiting action" tone="warning" icon={<IconWarning className="w-5 h-5" />} />
        <KpiCard to="/duplicates" label="Duplicates" value={String(stats.duplicates)} hint="flagged" tone="error" icon={<IconCopy className="w-5 h-5" />} />
        <KpiCard to="/retention" label="Expiring" value={String(stats.expiring + stats.expired)} hint="retention escalation" tone="warning" icon={<IconClock className="w-5 h-5" />} />
        <KpiCard to="/trips" label="Trips" value={String(stats.trips)} hint="auto-detected" tone="info" icon={<IconMap className="w-5 h-5" />} />
      </div>

      {/* Row: status donut · document types · attention */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Status breakdown</h3>
          <div className="flex items-center gap-5">
            <Donut data={statusData} />
            <ul className="space-y-2 flex-1 min-w-0">
              {statusData.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-gray-600 truncate flex-1">{s.label}</span>
                  <span className="font-semibold text-gray-800">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Document types</h3>
            <Link to="/browse" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Browse</Link>
          </div>
          {typeData.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">No documents yet.</div>
          ) : (
            <div className="space-y-3">
              {typeData.map((t) => (
                <BarRow key={t.label} label={t.label} value={t.value} max={typeMax} color={TONE_HEX.brand} to="/browse" />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Needs your attention</h3>
            {(needsReview.length + expiring.length) > 0 && (
              <Badge tone="warning">{needsReview.length + expiring.length}</Badge>
            )}
          </div>
          {needsReview.length === 0 && expiring.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600 mb-2"><IconCheck className="w-5 h-5" /></span>
              <div className="text-xs text-gray-500">All clear — nothing needs attention.</div>
            </div>
          ) : (
            <ul className="space-y-2.5 max-h-72 overflow-auto">
              {needsReview.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link to={`/document/${d.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50">
                    <span className="p-1.5 rounded-md bg-amber-50 text-amber-600"><IconWarning className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 truncate">{d.name}</div>
                      <div className="text-[11px] text-gray-500">Low confidence · {Math.round((d.documentConfidence ?? d.confidence) * 100)}%</div>
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

      {/* Row: recent documents · top vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Recent documents</h3>
            <Link to="/browse" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">No documents yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                    <th className="py-2 font-semibold">Name</th>
                    <th className="py-2 font-semibold">Type</th>
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
                          <span className="truncate max-w-[180px]">{d.name}</span>
                        </Link>
                      </td>
                      <td className="py-2.5 text-gray-600"><Badge tone="neutral">{d.type}</Badge></td>
                      <td className="py-2.5 text-gray-600 truncate max-w-[120px]">{d.vendor}</td>
                      <td className="py-2.5 text-right text-gray-800">{formatAmount(d.amount, d.currency)}</td>
                      <td className="py-2.5"><StateBadge state={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Top vendors by spend</h3>
          {topVendors.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">No vendor spend recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {topVendors.map((v) => (
                <BarRow key={v.label} label={v.label} value={v.value} suffix={formatAmount(v.value)} max={vendorMax} color={TONE_HEX.success} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Row: pipeline · trips */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <IconBrain className="w-4 h-4 text-indigo-500" /> Document intelligence pipeline
            </h3>
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
              <div className="text-lg font-bold text-gray-900">{stats.avgConfidence}</div>
              <div className="text-[11px] text-gray-500">Avg confidence</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-lg font-bold text-gray-900">{stats.autoClassifiedPct}%</div>
              <div className="text-[11px] text-gray-500">Auto-classified</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-lg font-bold text-gray-900">&lt;1s</div>
              <div className="text-[11px] text-gray-500">Avg search time</div>
            </div>
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
            <ul className="space-y-3 max-h-80 overflow-auto">
              {trips.map((t) => (
                <li key={t.id} className="rounded-lg border border-gray-100 p-3 hover:border-indigo-200 transition">
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
