import katex from 'katex'
import { memo, useMemo } from 'react'
import { tokenize } from '../lib/rich'

const cache = new Map<string, string>()

function renderMath(tex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${tex}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  // KaTeX escapes all text it emits. trust:false disables \href, \url, \htmlClass and friends.
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxSize: 20,
    maxExpand: 200,
    output: 'htmlAndMathml'
  })
  if (cache.size > 2000) cache.clear()
  cache.set(key, html)
  return html
}

/** Renders untrusted quiz text: plain text is escaped by React; maths goes through KaTeX. */
export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => tokenize(text), [text])
  return (
    <span className={className ? `rich ${className}` : 'rich'}>
      {segments.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.value}</span>
        if (s.kind === 'code') return <code key={i}>{s.value}</code>
        return (
          <span
            key={i}
            className={s.display ? 'math math-display' : 'math'}
            dangerouslySetInnerHTML={{ __html: renderMath(s.value, s.display) }}
          />
        )
      })}
    </span>
  )
})
