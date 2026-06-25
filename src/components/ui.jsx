// Reusable UI primitives — defined once and reused everywhere, per the
// Design & Theme component patterns (badges, cards, buttons, inputs, progress).
import { statusStyles, barColors, toneForState } from '../lib/theme.js'

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${statusStyles[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// Badge that derives its tone from a domain state string.
export function StateBadge({ state, className = '' }) {
  return (
    <Badge tone={toneForState(state)} className={className}>
      {state}
    </Badge>
  )
}

export function Card({ children, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`bg-white border border-gray-200 rounded-xl shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function SectionTitle({ children, className = '' }) {
  return (
    <h2 className={`text-[10px] font-semibold tracking-wider uppercase text-slate-500 ${className}`}>
      {children}
    </h2>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...rest
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-sm px-6 py-2.5',
  }
  const variants = {
    // Commit-style solid pill — black in light mode, white in dark mode.
    primary: 'bg-gray-900 text-white hover:bg-black shadow-sm dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200',
    // Indigo → blue accent gradient.
    gradient:
      'bg-gradient-to-r from-indigo-500 to-blue-500 text-white hover:opacity-90 shadow-sm',
    secondary:
      'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 shadow-sm',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function Input({ className = '', ...rest }) {
  return (
    <input
      className={`w-full text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-800 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition ${className}`}
      {...rest}
    />
  )
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select
      className={`text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Progress({ value = 0, tone = 'brand', className = '' }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={`h-2 w-full rounded-full bg-gray-100 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${barColors[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Avatar({ name = '', className = '' }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white text-xs font-semibold ${className}`}
    >
      {initials}
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'brand', icon }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
            {label}
          </div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
          {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
        </div>
        {icon && (
          <div className={`p-2 rounded-lg ${statusStyles[tone]} ring-0`}>{icon}</div>
        )}
      </div>
    </Card>
  )
}

export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="text-gray-300 mb-3">{icon}</div>}
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {hint && <div className="mt-1 text-xs text-gray-500 max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`animate-spin text-indigo-500 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <Spinner className="w-8 h-8" />
      <div className="mt-3 text-sm">{label}</div>
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  const msg = error?.message || 'Something went wrong.'
  const isConn = error?.status === 0
  return (
    <Card className="p-8">
      <div className="flex flex-col items-center text-center">
        <div className="p-3 rounded-xl bg-rose-50 text-rose-600 mb-3">
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-gray-800">{isConn ? 'Backend not reachable' : 'Could not load data'}</div>
        <div className="mt-1 text-xs text-gray-500 max-w-sm">{msg}</div>
        {isConn && (
          <div className="mt-2 text-[11px] text-gray-400">
            Start the API: <code className="bg-gray-100 px-1.5 py-0.5 rounded">cd server &amp;&amp; npm start</code>
          </div>
        )}
        {onRetry && <Button className="mt-4" variant="secondary" onClick={onRetry}>Retry</Button>}
      </div>
    </Card>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
