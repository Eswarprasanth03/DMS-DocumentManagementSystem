import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Button, Input } from '../components/ui.jsx'
import { IconBolt, IconShield, IconBrain, IconClock } from '../components/icons.jsx'

const HIGHLIGHTS = [
  { icon: IconBrain, title: 'AI auto-classification', text: 'OCR + LayoutLMv3 + LLM file every drop automatically.' },
  { icon: IconClock, title: 'Retention & lifecycle', text: '6 rule types with T-90 / T-30 expiry escalation.' },
  { icon: IconShield, title: 'DPDP 2023 compliant', text: 'India residency, consent, immutable audit trail.' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('priya@flowsphere.io')
  const [password, setPassword] = useState('demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const from = location.state?.from?.pathname || '/'

  const ACCOUNTS = [
    { email: 'priya@flowsphere.io', role: 'Admin' },
    { email: 'arjun@flowsphere.io', role: 'Manager' },
    { email: 'sara@flowsphere.io', role: 'Viewer' },
  ]

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Brand panel */}
      <div className="hidden lg:flex w-1/2 bg-slate-900 text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-10 w-96 h-96 rounded-full bg-gradient-to-br from-fuchsia-500/20 to-indigo-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 shadow-lg shadow-indigo-500/40">
            <IconBolt className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-semibold">FlowSphere DMS</div>
            <div className="text-xs text-slate-400">Automate. Orchestrate. Scale.</div>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-3xl font-bold leading-tight">
            Zero-effort document management.
          </h1>
          <p className="mt-3 text-slate-300 max-w-md">
            Capture, classify, organise, secure, search, retain, and audit every
            document automatically — with no manual filing.
          </p>
          <div className="mt-8 space-y-4">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/10">
                  <h.icon className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <div className="text-sm font-medium">{h.title}</div>
                  <div className="text-xs text-slate-400">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-slate-500">
          © 2026 FlowSphere · Netlink AI Portfolio · India region
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
              <IconBolt className="w-5 h-5" />
            </div>
            <span className="font-semibold text-gray-900">FlowSphere DMS</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
          <p className="mt-1 text-sm text-gray-500">Sign in to your DMS workspace.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Demo accounts (RBAC)</label>
              <div className="grid grid-cols-3 gap-2">
                {ACCOUNTS.map((a) => (
                  <button
                    type="button"
                    key={a.email}
                    onClick={() => { setEmail(a.email); setPassword('demo') }}
                    className={`text-xs rounded-lg border px-2 py-2 transition ${
                      email === a.email
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {a.role}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                Role drives RBAC navigation and actions across the app.
              </p>
            </div>

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-center text-[11px] text-gray-400">
              Demo build · password is <code className="bg-gray-100 px-1 rounded">demo</code> · JWT + OAuth 2.0 in production
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
