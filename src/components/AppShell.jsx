import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { Avatar, Badge } from './ui.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import {
  IconBolt, IconDashboard, IconUpload, IconFolder, IconSearch, IconMap,
  IconClock, IconLock, IconHistory, IconShield, IconBell, IconHelp,
  IconSettings, IconLogout, IconDocCheck, IconSignature, IconChevronDown, IconChevronRight,
  IconCopy, IconTrash, IconSun, IconMoon, IconMonitor,
} from './icons.jsx'

function ThemeToggle() {
  const { theme, cycle } = useTheme()
  const Icon = theme === 'light' ? IconSun : theme === 'dark' ? IconMoon : IconMonitor
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'
  return (
    <button
      onClick={cycle}
      title={`Theme: ${label} (click to switch)`}
      aria-label={`Theme: ${label}`}
      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
    >
      <Icon className="w-5 h-5" />
    </button>
  )
}

// RBAC-driven navigation. Sections show/hide by permission, so the chrome is
// role-aware (Live-data-driven, semantic, one-shell-many-pages principles).
const NAV = [
  {
    section: 'Main',
    items: [
      { to: '/', label: 'Dashboard', icon: IconDashboard, perm: 'dashboard', end: true },
      { to: '/upload', label: 'Capture & Upload', icon: IconUpload, perm: 'upload' },
      { to: '/browse', label: 'Browse Folders', icon: IconFolder, perm: 'browse' },
      { to: '/search', label: 'Search', icon: IconSearch, perm: 'search' },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      // { to: '/trips', label: 'Trip Detection', icon: IconMap, perm: 'trips' },
      { to: '/review', label: 'Doc Review', icon: IconDocCheck, perm: 'upload' },
      { to: '/duplicates', label: 'Duplicates', icon: IconCopy, perm: 'upload' },
      { to: '/trash', label: 'Trash', icon: IconTrash, perm: 'upload' },
    ],
  },
  {
    section: 'Compliance',
    items: [
      { to: '/retention', label: 'Retention', icon: IconClock, perm: 'retention' },
      { to: '/bonds', label: 'Permanent Bonds', icon: IconLock, perm: 'bonds' },
      { to: '/audit', label: 'Audit Trail', icon: IconHistory, perm: 'audit' },
      { to: '/compliance', label: 'Compliance Export', icon: IconShield, perm: 'compliance' },
      { to: '/esign', label: 'eSign', icon: IconSignature, perm: 'esign' },
    ],
  },
  {
    section: 'Account',
    items: [{ to: '/settings', label: 'Settings', icon: IconSettings, perm: 'settings' }],
  },
]

function Sidebar({ can }) {
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[#0a0e17] text-slate-300 border-r border-slate-800/60 sticky top-0 h-screen">
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-slate-800/80">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30">
          <IconBolt className="w-5 h-5" />
        </div>
        <div className="leading-tight">
          <div className="text-white font-semibold text-sm">FlowSphere</div>
          <div className="text-[10px] text-slate-500 tracking-wide">DMS · Standalone</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {NAV.map((group) => {
          const items = group.items.filter((it) => can(it.perm))
          if (!items.length) return null
          return (
            <div key={group.section}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                {group.section}
              </div>
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors border-l-2 ${
                        isActive
                          ? 'bg-indigo-500/15 border-indigo-400 text-white'
                          : 'border-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white'
                      }`
                    }
                  >
                    <it.icon className="w-[18px] h-[18px] shrink-0" />
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 text-[10px] text-slate-500">
        India region · DPDP 2023 ready
      </div>
    </aside>
  )
}

function NotificationMenu({ open, onClose, notifications, unread, onMarkAll, onOpen }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 mt-2 w-80 z-40 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Notifications</span>
          {unread > 0 ? (
            <button onClick={onMarkAll} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">Mark all read</button>
          ) : (
            <Badge tone="neutral">{notifications.length}</Badge>
          )}
        </div>
        {notifications.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-gray-400">You're all caught up.</div>
        )}
        <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
          {notifications.map((n) => {
            const clickable = Boolean(n.docId || n.link)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpen(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        n.tone === 'error' ? 'bg-rose-500' : n.tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${n.read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</span>
                        {n.ts === 'live' && <Badge tone="success">live</Badge>}
                      </div>
                      <div className="text-xs text-gray-500">{n.detail}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-gray-400">{n.ts && n.ts.includes && n.ts.includes('T') ? new Date(n.ts).toLocaleString() : (n.ts === 'live' ? 'Live status' : n.ts)}</span>
                        {clickable && <span className="text-[10px] font-medium text-indigo-600 inline-flex items-center gap-0.5">View <IconChevronRight className="w-3 h-3" /></span>}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 hover:bg-gray-100 transition"
      >
        <Avatar name={user.name} className="w-8 h-8" />
        <div className="hidden sm:block text-left leading-tight">
          <div className="text-sm font-medium text-gray-800">{user.name}</div>
          <div className="text-[10px] text-gray-500">{user.role}</div>
        </div>
        <IconChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-56 z-40 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-medium text-gray-900">{user.name}</div>
              <div className="text-xs text-gray-500">{user.email}</div>
              <div className="mt-2"><Badge tone="brand">{user.role}</Badge></div>
            </div>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <IconLogout className="w-4 h-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function buildStatsAlerts(stats, can) {
  if (!stats) return []
  const out = []
  if ((stats.expiring || stats.expired) && can('retention'))
    out.push({ id: 'n-ret', tone: 'warning', title: `${stats.expiring + stats.expired} documents expiring/expired`, detail: 'Retention escalation', ts: 'live', read: true, link: '/retention' })
  if (stats.trips && can('trips'))
    out.push({ id: 'n-trip', tone: 'info', title: `${stats.trips} trip(s) detected`, detail: 'taxi + hotel within 72h', ts: 'live', read: true, link: '/trips' })
  if (stats.duplicates && can('upload'))
    out.push({ id: 'n-dup', tone: 'error', title: `${stats.duplicates} duplicate(s) flagged`, detail: 'vendor + amount + date match', ts: 'live', read: true, link: '/duplicates' })
  if (stats.needsReview && can('review'))
    out.push({ id: 'n-rev', tone: 'warning', title: `${stats.needsReview} document(s) need review`, detail: 'confidence < 0.75', ts: 'live', read: true, link: '/review' })
  return out
}

function Topbar({ user, onLogout }) {
  const { can } = useAuth()
  const [notifOpen, setNotifOpen] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const { data: statsData } = useApi(() => api.stats(), [])
  const { data: notifData, reload: reloadNotif } = useApi(() => api.notifications(), [])
  const personal = notifData?.notifications || []
  const unread = notifData?.unread || 0
  // Personal (per-user) notifications first, then live operational alerts.
  const notifications = [...personal, ...buildStatsAlerts(statsData, can)]
  const markAllRead = async () => { try { await api.readAllNotifications(); reloadNotif() } catch { /* ignore */ } }
  const openNotif = async (n) => {
    if (n.id && !String(n.id).startsWith('n-') && !n.read) {
      try { await api.markNotificationRead(n.id); reloadNotif() } catch { /* ignore */ }
    }
    setNotifOpen(false)
    const dest = n.docId ? `/document/${n.docId}` : n.link
    if (dest) navigate(dest)
  }
  return (
    <header className="sticky top-0 z-20 h-16 bg-white border-b border-gray-200 flex items-center gap-3 px-4 md:px-6">
      <div className="relative flex-1 max-w-md">
        <IconSearch className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/search?q=${encodeURIComponent(q)}`) }}
          placeholder="Search documents, vendors, tags…"
          className="w-full text-sm rounded-lg bg-gray-50 border border-gray-200 pl-9 pr-16 py-2 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
        />
        <kbd className="hidden sm:inline-flex items-center absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <div className="relative">
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
            aria-label="Notifications"
          >
            <IconBell className="w-5 h-5" />
            {(unread > 0 || notifications.length > 0) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
            )}
          </button>
          <NotificationMenu open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} unread={unread} onMarkAll={markAllRead} onOpen={openNotif} />
        </div>
        <ThemeToggle />
        <button
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
          aria-label="Help"
        >
          <IconHelp className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  )
}

export default function AppShell({ children }) {
  const { user, logout, can } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex fs-app-bg">
      <Sidebar can={can} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar user={user} onLogout={handleLogout} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
