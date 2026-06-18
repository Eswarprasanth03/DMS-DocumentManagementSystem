import { useState } from 'react'
import { Card, PageHeader, Badge, StateBadge, Button, EmptyState, Input, Select, Loading, ErrorState } from '../components/ui.jsx'
import { IconSignature, IconFile, IconCheck, IconClock } from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'

export default function ESign() {
  const { data, loading, error, reload } = useApi(() => api.esign(), [])
  const [creating, setCreating] = useState(false)
  const [doc, setDoc] = useState('')
  const [provider, setProvider] = useState('DocuSign')
  const [signer, setSigner] = useState('')
  const [busy, setBusy] = useState(null)

  if (loading) return <Loading label="Loading envelopes…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const envelopes = data.envelopes

  const create = async () => {
    if (!doc.trim() || !signer.trim()) return
    setBusy('create')
    try { await api.createEnvelope({ doc: doc.trim(), provider, signer: signer.trim() }); setDoc(''); setSigner(''); setCreating(false); await reload() }
    finally { setBusy(null) }
  }
  const send = async (id) => { setBusy(id); try { await api.sendEnvelope(id); await reload() } finally { setBusy(null) } }

  return (
    <div>
      <PageHeader title="eSign" subtitle="Send documents for signature via DocuSign / Adobe Sign; status syncs into the audit trail."
        actions={<Button variant="gradient" onClick={() => setCreating((c) => !c)}><IconSignature className="w-4 h-4" /> New envelope</Button>} />

      {creating && (
        <Card className="p-5 mb-4 border-indigo-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Document</label><Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="contract.pdf" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Provider</label><Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full"><option>DocuSign</option><option>Adobe Sign</option></Select></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Signer email</label><Input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="signer@client.com" /></div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={busy === 'create'} onClick={create}><IconCheck className="w-4 h-4" /> Create envelope</Button>
          </div>
        </Card>
      )}

      {envelopes.length === 0 ? (
        <Card><EmptyState icon={<IconSignature className="w-12 h-12" />} title="No envelopes yet" hint="Create an envelope to send a document for signature." /></Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                  <th className="px-5 py-2.5 font-semibold">Document</th>
                  <th className="py-2.5 font-semibold">Provider</th>
                  <th className="py-2.5 font-semibold">Signer</th>
                  <th className="py-2.5 font-semibold">Sent</th>
                  <th className="py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {envelopes.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3"><div className="flex items-center gap-2 text-gray-800"><IconFile className="w-4 h-4 text-gray-400" /><span className="truncate max-w-[220px]">{e.doc}</span></div></td>
                    <td className="py-3"><Badge tone="neutral">{e.provider}</Badge></td>
                    <td className="py-3 text-gray-600">{e.signer}</td>
                    <td className="py-3 text-gray-500">{e.sent}</td>
                    <td className="py-3"><StateBadge state={e.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {e.status === 'Draft' ? (
                        <Button size="sm" disabled={busy === e.id} onClick={() => send(e.id)}><IconSignature className="w-3.5 h-3.5" /> Send</Button>
                      ) : e.status === 'Sent' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600"><IconClock className="w-3.5 h-3.5" /> Awaiting signature</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><IconCheck className="w-3.5 h-3.5" /> Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
