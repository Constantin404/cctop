const two = (n: number): string => String(n).padStart(2, '0')

export function dur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${two(m % 60)}m`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24}h`
}

export function clock(t: number, seconds = false): string {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? ':' + two(d.getSeconds()) : ''}`
}

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const

/** Short reset label: a countdown inside a day, weekday + time beyond that. */
export function resetIn(resetsAt: number, now: number): string {
  const left = resetsAt - now
  if (left <= 0) return 'jetzt'
  if (left < 24 * 3600_000) return dur(left)
  return `${DAYS[new Date(resetsAt).getDay()] ?? ''} ${clock(resetsAt)}`
}

export function tokens(n: number | null): string {
  if (n === null) return ''
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

export function base(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}
