import { useState } from 'react'
import { Card, PageHeader, Badge, Button, Avatar, SectionTitle } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { IconShield, IconBrain, IconCheck } from '../components/icons.jsx'

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition ${on ? 'bg-indigo-500' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  )
}

function Row({ title, hint, children }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm text-gray-800">{title}</div>
        {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [residency, setResidency] = useState(true)
  const [consent, setConsent] = useState(true)
  const [autoClassify, setAutoClassify] = useState(true)
  const [hotFolder, setHotFolder] = useState(true)

  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace, AI pipeline and DPDP compliance configuration." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <SectionTitle className="mb-3">Profile</SectionTitle>
          <div className="flex items-center gap-3">
            <Avatar name={user.name} className="w-12 h-12 text-sm" />
            <div>
              <div className="text-sm font-semibold text-gray-900">{user.name}</div>
              <div className="text-xs text-gray-500">{user.email}</div>
              <div className="mt-1"><Badge tone="brand">{user.role}</Badge></div>
            </div>
          </div>
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Organisation</span><span className="text-gray-800">{user.org || 'FlowSphere'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Region</span><span className="text-gray-800">{user.region || 'India (Mumbai)'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Auth</span><span className="text-gray-800">JWT + OAuth 2.0</span></div>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle className="mb-1 flex items-center gap-1.5"><IconBrain className="w-3.5 h-3.5" /> AI pipeline</SectionTitle>
          <div className="divide-y divide-gray-50">
            <Row title="Auto-classification" hint="OCR + LayoutLMv3 + LLM">
              <Toggle on={autoClassify} onChange={setAutoClassify} />
            </Row>
            <Row title="Hot-folder watcher" hint="Ingest /drop automatically">
              <Toggle on={hotFolder} onChange={setHotFolder} />
            </Row>
            <Row title="Confidence threshold" hint="Below this → manual review">
              <Badge tone="neutral">0.75</Badge>
            </Row>
            <Row title="Embeddings" hint="gemini-embedding-001 + fallback">
              <Badge tone="success"><IconCheck className="w-3 h-3" /> connected</Badge>
            </Row>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle className="mb-1 flex items-center gap-1.5"><IconShield className="w-3.5 h-3.5" /> DPDP 2023 compliance</SectionTitle>
          <div className="divide-y divide-gray-50">
            <Row title="India data residency" hint="Store & process in India region">
              <Toggle on={residency} onChange={setResidency} />
            </Row>
            <Row title="Consent management" hint="Track & honour data-subject consent">
              <Toggle on={consent} onChange={setConsent} />
            </Row>
            <Row title="Breach notification" hint="Workflow armed for 72h reporting">
              <Badge tone="success"><IconCheck className="w-3 h-3" /> armed</Badge>
            </Row>
            <Row title="Immutable audit" hint="Append-only on every state change">
              <Badge tone="brand">enforced</Badge>
            </Row>
          </div>
        </Card>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary">Reset</Button>
        <Button><IconCheck className="w-4 h-4" /> Save changes</Button>
      </div>
    </div>
  )
}
