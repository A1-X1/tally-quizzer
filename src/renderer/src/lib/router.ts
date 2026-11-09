import { useEffect, useState } from 'react'

export type Route =
  | { name: 'dashboard' }
  | { name: 'modules' }
  | { name: 'module'; id: number }
  | { name: 'quiz'; id: number }
  | { name: 'attempt'; id: number }
  | { name: 'result'; id: number }
  | { name: 'history'; moduleId: number | null; quizId: number | null }
  | { name: 'help'; section: string | null }
  | { name: 'settings' }
  | { name: 'upload'; moduleId: number | null }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [pathPart, query = ''] = h.split('?')
  const parts = pathPart.split('/').filter(Boolean)
  const q = new URLSearchParams(query)
  const num = (v: string | null | undefined): number | null => {
    const n = Number(v)
    return v && Number.isInteger(n) && n > 0 ? n : null
  }
  switch (parts[0]) {
    case 'modules': {
      const id = num(parts[1])
      return id ? { name: 'module', id } : { name: 'modules' }
    }
    case 'quiz':
      return num(parts[1]) ? { name: 'quiz', id: num(parts[1]) as number } : { name: 'dashboard' }
    case 'attempt':
      return num(parts[1]) ? { name: 'attempt', id: num(parts[1]) as number } : { name: 'dashboard' }
    case 'result':
      return num(parts[1]) ? { name: 'result', id: num(parts[1]) as number } : { name: 'dashboard' }
    case 'history':
      return { name: 'history', moduleId: num(q.get('module')), quizId: num(q.get('quiz')) }
    case 'help':
      return { name: 'help', section: parts[1] ?? null }
    case 'settings':
      return { name: 'settings' }
    case 'upload':
      return { name: 'upload', moduleId: num(q.get('module')) }
    default:
      return { name: 'dashboard' }
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'dashboard':
      return '#/'
    case 'modules':
      return '#/modules'
    case 'module':
      return `#/modules/${r.id}`
    case 'quiz':
      return `#/quiz/${r.id}`
    case 'attempt':
      return `#/attempt/${r.id}`
    case 'result':
      return `#/result/${r.id}`
    case 'history': {
      const q = new URLSearchParams()
      if (r.moduleId) q.set('module', String(r.moduleId))
      if (r.quizId) q.set('quiz', String(r.quizId))
      const s = q.toString()
      return `#/history${s ? `?${s}` : ''}`
    }
    case 'help':
      return r.section ? `#/help/${r.section}` : '#/help'
    case 'settings':
      return '#/settings'
    case 'upload':
      return r.moduleId ? `#/upload?module=${r.moduleId}` : '#/upload'
  }
}

export function go(r: Route, replace = false): void {
  const h = href(r)
  if (replace) history.replaceState(null, '', h)
  else location.hash = h
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const on = (): void => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
