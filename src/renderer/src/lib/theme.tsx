import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemePreference } from '../../../shared/types'
import { api } from '../api'

export function applyTheme(pref: ThemePreference, systemDark: boolean): void {
  const dark = pref === 'dark' || (pref === 'system' && systemDark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  void api('app:setTitleBarTheme', { dark }).catch(() => undefined)
}

const ThemeCtx = createContext<{ pref: ThemePreference; setPref: (p: ThemePreference) => void }>({
  pref: 'system',
  setPref: () => undefined
})

/**
 * The main process reports the operating system's appearance, both at start and
 * whenever it changes, so "System" always follows the OS.
 */
export function ThemeProvider({ initial, children, persist }: { initial: ThemePreference; children: ReactNode; persist: boolean }) {
  const [pref, setPrefState] = useState<ThemePreference>(initial)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    void api('app:systemDark').then(setSystemDark).catch(() => undefined)
    const off = window.tally.onSystemTheme(setSystemDark)
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setSystemDark(m.matches)
    m.addEventListener('change', on)
    return () => {
      off()
      m.removeEventListener('change', on)
    }
  }, [])

  useEffect(() => applyTheme(pref, systemDark), [pref, systemDark])

  const setPref = (p: ThemePreference): void => {
    setPrefState(p)
    if (persist) {
      void api('settings:setTheme', { theme: p }).then(() => api('app:systemDark').then(setSystemDark))
    }
  }
  return <ThemeCtx.Provider value={{ pref, setPref }}>{children}</ThemeCtx.Provider>
}

export const useTheme = (): { pref: ThemePreference; setPref: (p: ThemePreference) => void } => useContext(ThemeCtx)
