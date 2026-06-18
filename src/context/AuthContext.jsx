import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api, getToken, setToken } from '../lib/api.js'

const AuthContext = createContext(null)

const ROLE_PERMS = {
  Admin: ['*'],
  Manager: [
    'dashboard', 'upload', 'browse', 'search', 'trips', 'review',
    'retention', 'bonds', 'audit', 'compliance', 'esign', 'settings',
  ],
  Viewer: ['dashboard', 'browse', 'search', 'audit'],
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)

  // Restore session from an existing token on load.
  useEffect(() => {
    let active = true
    async function boot() {
      if (!getToken()) { setBooting(false); return }
      try {
        const { user } = await api.me()
        if (active) setUser(user)
      } catch {
        setToken(null)
      } finally {
        if (active) setBooting(false)
      }
    }
    boot()
    return () => { active = false }
  }, [])

  const login = useCallback(async (email, password) => {
    const { token, user } = await api.login(email, password)
    setToken(token)
    setUser(user)
    return user
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const can = useCallback(
    (perm) => {
      if (!user) return false
      const perms = ROLE_PERMS[user.role] || []
      return perms.includes('*') || perms.includes(perm)
    },
    [user],
  )

  return (
    <AuthContext.Provider value={{ user, booting, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
