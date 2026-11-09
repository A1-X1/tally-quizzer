import type { SVGProps } from 'react'

const paths = {
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4m0 0-5 5m5-5 5 5M5 20h14',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.4-2.1.1-1.1-.1-1.1 2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-1.9-1.1L14.8 3h-4l-.4 2.6a7.6 7.6 0 0 0-1.9 1.1l-2.4-.9-2 3.4 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.4 2.4-.9c.6.5 1.2.8 1.9 1.1l.4 2.6h4l.4-2.6c.7-.3 1.3-.6 1.9-1.1l2.4.9 2-3.4-2-1.6Z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  cross: 'M7 7l10 10M17 7 7 17',
  arrowLeft: 'M19 12H5m0 0 6-6m-6 6 6 6',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  archive: 'M4 7h16M5 7v12h14V7M3 4h18v3H3zM10 11h4',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  play: 'M7 5v14l12-7L7 5Z',
  retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  external: 'M14 4h6v6m0-6-9 9M10 6H5v13h13v-5',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5v.5',
  warning: 'M12 4 2.5 20h19L12 4Zm0 6v5m0 2.5v.5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  monitor: 'M3 5h18v11H3zM8 20h8m-4-4v4',
  sort: 'm8 9 4-4 4 4M8 15l4 4 4-4',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
} as const

export type IconName = keyof typeof paths

export function Icon({
  name,
  size = 18,
  weight = 1.8,
  title,
  ...rest
}: { name: IconName; size?: number; weight?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "stroke">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={paths[name]} />
    </svg>
  )
}

/** The Tally mark: four strokes crossed by a fifth. Used in the navbar and welcome screen. */
export function TallyMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className} focusable="false">
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path d="M7 6v20M12.5 6v20M18 6v20M23.5 6v20" />
      </g>
      <path d="M3.5 22.5 28.5 9.5" stroke="var(--highlight)" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  )
}
