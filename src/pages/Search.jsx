import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, PageHeader, Badge, StateBadge, EmptyState, Input, Loading } from '../components/ui.jsx'
import { IconSearch, IconFile, IconBrain, IconX } from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

const RETENTIONS = ['3yr', '5yr', '7yr', '8yr', 'permanent']

function FacetGroup({ title, options, selected, onToggle, counts }) {
  if (!options.length) return null
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 mb-2">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = selected.includes(o)
          return (
            <button key={o} onClick={() => onToggle(o)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset transition ${
                active ? 'bg-indigo-500 text-white ring-indigo-500' : 'bg-gray-50 text-gray-600 ring-gray-200 hover:bg-gray-100'
              }`}>
              {o}
              {counts?.[o] != null && <span className={active ? 'text-indigo-100' : 'text-gray-400'}>{counts[o]}</span>}
              {active && <IconX className="w-3 h-3" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Search() {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [types, setTypes] = useState([])
  const [clientF, setClientF] = useState([])
  const [retF, setRetF] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [took, setTook] = useState(0)

  const toggle = (setter) => (v) => setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))

  useEffect(() => {
    let active = true
    const t0 = performance.now()
    setLoading(true)
    const handle = setTimeout(() => {
      api.search({ q, types, clients: clientF, retentions: retF })
        .then((r) => { if (active) { setData(r); setTook(Math.max(1, Math.round(performance.now() - t0))) } })
        .finally(() => active && setLoading(false))
    }, 200)
    return () => { active = false; clearTimeout(handle) }
  }, [q, types, clientF, retF])

  const facets = data?.facets || { type: {}, client: {}, retention: {} }
  const results = data?.results || []
  const activeFilters = types.length + clientF.length + retF.length
  const clearAll = () => { setTypes([]); setClientF([]); setRetF([]); setQ('') }

  return (
    <div>
      <PageHeader title="Search" subtitle="Faceted metadata + semantic search (local embeddings). RBAC-filtered, sub-second." />

      <div className="relative mb-4">
        <IconSearch className="w-5 h-5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, vendor, type, tag, client…" className="pl-11 py-3 text-base" autoFocus />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="p-4 h-fit space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Filters</span>
            {activeFilters > 0 && <button onClick={clearAll} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">Clear ({activeFilters})</button>}
          </div>
          <FacetGroup title="Document type" options={Object.keys(facets.type)} selected={types} onToggle={toggle(setTypes)} counts={facets.type} />
          <FacetGroup title="Client" options={Object.keys(facets.client)} selected={clientF} onToggle={toggle(setClientF)} counts={facets.client} />
          <FacetGroup title="Retention" options={RETENTIONS.filter((r) => facets.retention[r])} selected={retF} onToggle={toggle(setRetF)} counts={facets.retention} />
        </Card>

        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600"><span className="font-semibold text-gray-900">{results.length}</span> result{results.length !== 1 ? 's' : ''}</span>
            <span className="text-[11px] text-gray-400">semantic + text · {took}ms</span>
          </div>

          {loading ? (
            <Loading label="Searching…" />
          ) : results.length === 0 ? (
            <Card><EmptyState icon={<IconSearch className="w-12 h-12" />} title="No documents match" hint="Try removing a filter or searching a different vendor, type, or tag." /></Card>
          ) : (
            <div className="space-y-2.5">
              {results.map((d) => (
                <Card key={d.id} className="p-4 hover:border-indigo-200 transition">
                  <Link to={`/document/${d.id}`} className="flex items-start gap-3">
                    <span className="p-2 rounded-lg bg-gray-50 text-gray-500"><IconFile className="w-5 h-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{d.name}</span>
                        <span className="text-sm font-semibold text-gray-900 shrink-0">{formatAmount(d.amount, d.currency)}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">{d.vendor} · {d.client} · {d.date}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{d.type}</Badge>
                        <Badge tone="brand">{d.retention}</Badge>
                        <StateBadge state={d.status} />
                        <Badge tone={d.confidence >= 0.75 ? 'success' : 'warning'}><IconBrain className="w-3 h-3" /> {Math.round(d.confidence * 100)}%</Badge>
                      </div>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
