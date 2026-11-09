import type { Channel, Req, Res, TallyBridge } from '../../shared/api'

declare global {
  interface Window {
    tally: TallyBridge
  }
}

export function api<C extends Channel>(channel: C, ...args: Req<C> extends void ? [] : [Req<C>]): Promise<Res<C>> {
  return window.tally.invoke(channel, ...args)
}

export const platform = (): string => window.tally?.platform ?? 'linux'

/** Errors from the main process arrive as "CODE::message". */
export function errorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const match = /([A-Z_]+)::/.exec(m)
  return match ? match[1] : 'ERROR'
}

export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const i = m.lastIndexOf('::')
  const msg = i >= 0 ? m.slice(i + 2) : m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  return msg || 'Something went wrong.'
}
