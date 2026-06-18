import { useState } from 'react'
import { Card, PageHeader, Badge, Button, Progress, Loading, ErrorState } from '../components/ui.jsx'
import { thresholdTone } from '../lib/theme.js'
import { IconShield, IconDownload, IconCheck, IconFile } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'

export default function Compliance() {
  const { data, loading, error, reload } = useApi(() => api.compliancePacks(), [])
  const [generating, setGenerating] = useState(null)
  const [done, setDone] = useState({})

  if (loading) return <Loading label="Loading compliance packs…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const generate = async (id) => {
    setGenerating(id)
    try {
      const res = await api.generatePack(id)
      const blob = new Blob([res.html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      setDone((d) => ({ ...d, [id]: url }))
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div>
      <PageHeader title="Compliance Export" subtitle="One-click audit packs (ISO / SOC 2 / DPDP / GST) generated from the immutable, hash-chained trail." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.packs.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white"><IconShield className="w-5 h-5" /></span>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{p.name}</div>
                  <div className="text-[11px] text-gray-500">{p.desc}</div>
                </div>
              </div>
              <Badge tone={thresholdTone(p.score)}>{p.score}% ready</Badge>
            </div>

            <div className="mt-4"><Progress value={p.score} tone={thresholdTone(p.score)} /></div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <IconFile className="w-3.5 h-3.5" /> {data.documents} docs · {data.auditEvents} audit events
              </div>
              {done[p.id] ? (
                <a href={done[p.id]} download={`${p.id}-compliance-pack.html`} target="_blank" rel="noreferrer">
                  <Button variant="secondary" size="sm"><IconDownload className="w-3.5 h-3.5" /> Download pack</Button>
                </a>
              ) : (
                <Button size="sm" disabled={generating === p.id} onClick={() => generate(p.id)}>
                  {generating === p.id ? 'Generating…' : <><IconShield className="w-3.5 h-3.5" /> Generate</>}
                </Button>
              )}
            </div>

            {done[p.id] && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                <IconCheck className="w-4 h-4" /> Pack generated from verified audit trail — ready for auditors.
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
