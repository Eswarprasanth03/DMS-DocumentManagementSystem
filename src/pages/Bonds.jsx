import { useState } from 'react'
import { Card, PageHeader, Badge, Button, EmptyState, Input, Loading, ErrorState } from '../components/ui.jsx'
import { IconLock, IconFile, IconShield, IconPlus, IconCheck } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'

export default function Bonds() {
  const { data, loading, error, reload } = useApi(() => api.bonds(), [])
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [companies, setCompanies] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <Loading label="Loading bonds…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const bonds = data.bonds

  const create = async () => {
    if (!label.trim()) return
    setBusy(true)
    try {
      await api.createBond({ label: label.trim(), companies: companies.split(',').map((s) => s.trim()).filter(Boolean), documents: [] })
      setLabel(''); setCompanies(''); setCreating(false); await reload()
    } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Permanent Bonds"
        subtitle="Inter-company locks that pin documents together permanently. Deletion requires two admins."
        actions={<Button variant="gradient" onClick={() => setCreating((c) => !c)}><IconPlus className="w-4 h-4" /> Create bond</Button>} />

      {creating && (
        <Card className="p-5 mb-4 border-indigo-200">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">New permanent bond</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bond label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme ↔ FlowSphere MSA" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Companies (comma-separated)</label>
              <Input value={companies} onChange={(e) => setCompanies(e.target.value)} placeholder="Acme Corp, FlowSphere" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            <IconLock className="w-4 h-4" /> Once confirmed, bonded documents cannot be deleted without two-admin approval.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={busy} onClick={create}><IconCheck className="w-4 h-4" /> Confirm bond</Button>
          </div>
        </Card>
      )}

      {bonds.length === 0 ? (
        <Card><EmptyState icon={<IconShield className="w-12 h-12" />} title="No permanent bonds yet" hint="Create a bond to permanently lock related inter-company documents together." /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bonds.map((b) => (
            <Card key={b.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600"><IconLock className="w-5 h-5" /></span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{b.label}</div>
                    <div className="text-[11px] text-gray-500">{b.companies.join(' ↔ ')}</div>
                  </div>
                </div>
                <Badge tone="brand">{b.status}</Badge>
              </div>
              <div className="mt-4 rounded-lg border border-gray-100 divide-y divide-gray-50">
                {(b.docNames || []).length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No documents linked yet.</div>}
                {(b.docNames || []).map((d) => (
                  <div key={d} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <IconFile className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-800 truncate">{d}</span>
                    <IconLock className="w-3.5 h-3.5 text-indigo-400 ml-auto" />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] text-gray-500">
                <span>Created by {b.createdBy}</span>
                <Badge tone="warning">{b.requires}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
