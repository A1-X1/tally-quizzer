import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, THEME_EVENT, type Channel, type IpcEnvelope, type Req, type Res, type TallyBridge } from '../shared/api'

const allowed = new Set<string>(CHANNELS)

const bridge: TallyBridge = {
  platform: process.platform,
  async invoke<C extends Channel>(channel: C, ...args: Req<C> extends void ? [] : [Req<C>]): Promise<Res<C>> {
    if (!allowed.has(channel)) throw new Error(`Unknown channel: ${String(channel)}`)
    const envelope = (await ipcRenderer.invoke(channel, args[0])) as IpcEnvelope<Res<C>>
    if (envelope.ok) return envelope.data
    throw new Error(envelope.error)
  },
  onSystemTheme(listener: (dark: boolean) => void): () => void {
    const handler = (_e: Electron.IpcRendererEvent, dark: unknown): void => listener(dark === true)
    ipcRenderer.on(THEME_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(THEME_EVENT, handler)
    }
  }
}

contextBridge.exposeInMainWorld('tally', bridge)
