import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'fs_dms_theme'
const ORDER = ['light', 'dark', 'system']

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme) {
  const root = document.documentElement
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) || 'system')

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
    if (theme !== 'system') return undefined
    // Follow OS changes while in "system" mode.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  // Resolved (effective) theme, useful for showing the right icon.
  const resolved = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
  const cycle = () => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length])

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, cycle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// Apply the saved theme as early as possible to avoid a flash of the wrong theme.
export function initThemeEarly() {
  try {
    applyTheme(localStorage.getItem(STORAGE_KEY) || 'system')
  } catch { /* ignore */ }
}
