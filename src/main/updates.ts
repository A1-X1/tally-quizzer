import { app, net } from 'electron'
import type { UpdateInfo } from '../shared/types'

export const RELEASE_API = 'https://api.github.com/repos/A1-X1/tally-quizzer/releases/latest'

/** Only URLs on GitHub that belong to this project's releases may be opened from an update check. */
const ALLOWED_DOWNLOAD = /^https:\/\/github\.com\/A1-X1\/tally-quizzer\/(releases\/|releases$)/

let checkInFlight = 0
let lastDownloads = new Set<string>()

/** The request filter consults this so that only an explicit update check reaches the network. */
export function isAllowedUpdateRequest(url: string): boolean {
  return checkInFlight > 0 && url === RELEASE_API
}

export function isOfferedDownload(url: string): boolean {
  return lastDownloads.has(url) && ALLOWED_DOWNLOAD.test(url)
}

/** Compare dotted versions numerically; a pre-release suffix sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string] => {
    const [core, pre = ''] = v.replace(/^v/i, '').split('-', 2)
    return [core.split('.').map((x) => Number.parseInt(x, 10) || 0), pre]
  }
  const [ca, pa] = parse(a)
  const [cb, pb] = parse(b)
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa < pb ? -1 : 1
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

/** Which release file suits this computer. */
export function pickAsset(assets: ReleaseAsset[], platform = process.platform, arch = process.arch): ReleaseAsset | null {
  const test =
    platform === 'win32'
      ? (n: string) => /^Tally-Setup-.*\.exe$/i.test(n)
      : platform === 'darwin'
        ? (n: string) => n.endsWith(`-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`)
        : (n: string) => /\.AppImage$/i.test(n)
  return assets.find((a) => test(a.name)) ?? null
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  checkInFlight++
  try {
    const res = await net.fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Tally/${current}` }
    })
    if (res.status === 404) {
      return { current, latest: null, newer: false, notes: null, publishedAt: null, pageUrl: null, download: null }
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const body = (await res.json()) as {
      tag_name?: string
      body?: string
      published_at?: string
      html_url?: string
      assets?: ReleaseAsset[]
    }
    const latest = (body.tag_name ?? '').replace(/^v/i, '')
    if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('The release information was not in the expected format.')
    const asset = pickAsset(Array.isArray(body.assets) ? body.assets : [])
    const pageUrl = typeof body.html_url === 'string' && ALLOWED_DOWNLOAD.test(body.html_url) ? body.html_url : null
    lastDownloads = new Set([asset?.browser_download_url, pageUrl].filter((u): u is string => !!u))
    return {
      current,
      latest,
      newer: compareVersions(latest, current) > 0,
      notes: typeof body.body === 'string' ? body.body.slice(0, 4000) : null,
      publishedAt: body.published_at ?? null,
      pageUrl,
      download: asset && ALLOWED_DOWNLOAD.test(asset.browser_download_url)
        ? { name: asset.name, url: asset.browser_download_url, bytes: asset.size }
        : null
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      /net::|fetch failed|ENOTFOUND|ERR_/i.test(msg)
        ? 'Tally could not reach GitHub. Check your internet connection and try again.'
        : msg
    )
  } finally {
    checkInFlight--
  }
}
