import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemePreference } from '../../../shared/types'
import { api } from '../api'

const media = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && media().matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  void api('app:setTitleBarTheme', { dark }).catch(() => undefined)
}

const ThemeCtx = createContext<{ pref: ThemePreference; setPref: (p: ThemePreference) => void }>({
  pref: 'system',
  setPref: () => undefined
})

export function ThemeProvider({ initial, children, persist }: { initial: ThemePreference; children: ReactNode; persist: boolean }) {
  const [pref, setPrefState] = useState<ThemePreference>(initial)
  useEffect(() => {
    applyTheme(pref)
    const m = media()
    const on = (): void => applyTheme(pref)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [pref])
  const setPref = (p: ThemePreference): void => {
    setPrefState(p)
    if (persist) void api('settings:setTheme', { theme: p })
  }
  return <ThemeCtx.Provider value={{ pref, setPref }}>{children}</ThemeCtx.Provider>
}

export const useTheme = (): { pref: ThemePreference; setPref: (p: ThemePreference) => void } => useContext(ThemeCtx)
