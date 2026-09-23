// Terminal primitives: cleaning untrusted text, display width, styled segments, btop-style boxes,
// gradient meters and braille area graphs. 256 colours only, so Terminal.app renders it the same
// as iTerm or Ghostty.

export interface Seg {
  t: string
  fg?: number
  bg?: number
  bold?: boolean
}

export const C = {
  text: 252,
  dim: 245,
  faint: 240,
  line: 238,
  title: 255,
  hot: 203,
  selBg: 236,
  work: 84,
  input: 221,
  idle: 244,
  done: 75,
  failed: 203,
  compact: 141,
  sub: 116,
  meterBg: 237,
} as const

// Box outline colours, after btop's default theme (cpu / mem / net / proc).
export const BORDER = { usage: 65, fleet: 101, agents: 60, log: 95 } as const

export const HEAT = [84, 120, 156, 192, 228, 222, 215, 209, 203, 197, 196] as const
export const COOL = [30, 37, 44, 51, 87, 123, 159] as const

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g
const CTRL = /[\x00-\x1f\x7f-\x9f]/g

/** Strips escape sequences and control characters so text read from disk cannot drive the terminal. */
export function clean(s: string): string {
  return s.replace(ANSI, '').replace(CTRL, ' ').replace(/\s+/g, ' ').trim()
}

function cpWidth(cp: number): number {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

export function width(s: string): number {
  let w = 0
  for (const ch of s) w += cpWidth(ch.codePointAt(0) ?? 0)
  return w
}

export function segsWidth(segs: readonly Seg[]): number {
  return segs.reduce((n, s) => n + width(s.t), 0)
}

/** Truncates (with an ellipsis) or pads plain text to exactly `w` columns. */
export function fit(s: string, w: number, align: 'left' | 'right' = 'left'): string {
  if (w <= 0) return ''
  const sw = width(s)
  if (sw > w) {
    let out = ''
    let used = 0
    for (const ch of s) {
      const cw = cpWidth(ch.codePointAt(0) ?? 0)
      if (used + cw > w - 1) break
      out += ch
      used += cw
    }
    return out + '…' + ' '.repeat(w - 1 - used)
  }
  const pad = ' '.repeat(w - sw)
  return align === 'left' ? s + pad : pad + s
}

function sgr(s: Omit<Seg, 't'>): string {
  const codes: string[] = []
  if (s.bold) codes.push('1')
  if (s.fg !== undefined) codes.push(`38;5;${s.fg}`)
  if (s.bg !== undefined) codes.push(`48;5;${s.bg}`)
  return codes.length ? `\x1b[${codes.join(';')}m` : ''
}

const RESET = '\x1b[0m'

/** Renders segments to exactly `w` columns, truncating with an ellipsis and padding in the base style. */
export function render(segs: readonly Seg[], w: number, base: Omit<Seg, 't'> = {}): string {
  if (w <= 0) return ''
  const over = segsWidth(segs) > w
  const limit = over ? w - 1 : w
  let out = ''
  let used = 0
  let last: Omit<Seg, 't'> = base
  for (const seg of segs) {
    if (used >= limit) break
    let text = ''
    for (const ch of seg.t) {
      const cw = cpWidth(ch.codePointAt(0) ?? 0)
      if (used + cw > limit) break
      text += ch
      used += cw
    }
    if (!text) continue
    const style = { ...base, ...seg }
    out += sgr(style) + text + RESET
    last = style
  }
  if (over) {
    out += sgr({ ...last, bold: false }) + '…' + RESET
    used += 1
  }
  if (used < w) out += sgr(base) + ' '.repeat(w - used) + RESET
  return out
}

export function grad(p: readonly number[], t: number): number {
  const i = Math.round(Math.min(1, Math.max(0, t)) * (p.length - 1))
  return p[i] ?? p[0] ?? C.text
}

function merge(segs: Seg[], t: string, fg: number): void {
  const last = segs[segs.length - 1]
  if (last && last.fg === fg) last.t += t
  else segs.push({ t, fg })
}

/** btop meter: a row of squares coloured along a heat gradient, the unfilled rest dimmed. */
export function meter(pct: number, w: number): Seg[] {
  if (w <= 0) return []
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)
  const segs: Seg[] = []
  for (let i = 0; i < filled; i++) merge(segs, '■', grad(HEAT, w === 1 ? 0 : i / (w - 1)))
  if (w > filled) segs.push({ t: '■'.repeat(w - filled), fg: C.meterBg })
  return segs
}

// Braille dots filled from the bottom of a cell: left column 7,3,2,1 and right column 8,6,5,4.
const LEFT = [0, 0x40, 0x44, 0x46, 0x47] as const
const RIGHT = [0, 0x80, 0xa0, 0xb0, 0xb8] as const

/** Area graph, two samples per cell and four dot rows per line, newest sample on the right. */
export function graph(values: readonly number[], max: number, cols: number, rows: number, palette: readonly number[]): Seg[][] {
  const need = cols * 2
  const v = values.slice(-need)
  const pad = need - v.length
  const levels = rows * 4
  const top = Math.max(1, max)
  const level = (x: number | undefined): number =>
    x === undefined || x <= 0 ? 0 : Math.max(1, Math.round((Math.min(x, top) / top) * levels))
  const dots = (n: number): number => Math.min(4, Math.max(0, n))
  const out: Seg[][] = []
  for (let r = 0; r < rows; r++) {
    const fromBottom = rows - 1 - r
    const fg = grad(palette, rows === 1 ? 0.5 : fromBottom / (rows - 1))
    const segs: Seg[] = []
    for (let c = 0; c < cols; c++) {
      const ia = c * 2 - pad
      const a = ia >= 0 ? v[ia] : undefined
      const b = ia + 1 >= 0 ? v[ia + 1] : undefined
      const bits = (LEFT[dots(level(a) - fromBottom * 4)] ?? 0) | (RIGHT[dots(level(b) - fromBottom * 4)] ?? 0)
      if (bits === 0 && fromBottom === 0) merge(segs, '⣀', C.line)
      else if (bits === 0) merge(segs, ' ', fg)
      else merge(segs, String.fromCodePoint(0x2800 + bits), fg)
    }
    out.push(segs)
  }
  return out
}

export interface Box {
  title: string
  key?: string
  color: number
  w: number
  h: number
  body: readonly Seg[][]
  /** Tag embedded in the top border, right-aligned. */
  tr?: Seg[]
  /** Tags embedded in the bottom border, left to right; the ones that don't fit are dropped. */
  footer?: Seg[][]
  rowBg?: (i: number) => number | undefined
}

function tag(inner: readonly Seg[], color: number): Seg[] {
  return [{ t: '─┐', fg: color }, ...inner, { t: '┌', fg: color }]
}

function border(l: string, r: string, groups: readonly Seg[][], right: readonly Seg[], w: number, color: number): string {
  const room = w - 2
  const rightSegs = right.length ? [...tag(right, color), { t: '─', fg: color }] : []
  const rw = segsWidth(rightSegs) <= room ? segsWidth(rightSegs) : 0
  const left: Seg[] = []
  for (const g of groups) {
    const t = tag(g, color)
    if (segsWidth(left) + segsWidth(t) + rw > room) break
    left.push(...t)
  }
  const fill = Math.max(0, room - segsWidth(left) - rw)
  return render([{ t: l, fg: color }, ...left, { t: '─'.repeat(fill), fg: color }, ...(rw ? rightSegs : []), { t: r, fg: color }], w)
}

export function box(b: Box): string[] {
  const inner = b.w - 2
  const title: Seg[] = [...(b.key ? [{ t: b.key, fg: C.hot, bold: true }] : []), { t: b.title, fg: C.title, bold: true }]
  const lines = [border('╭', '╮', [title], b.tr ?? [], b.w, b.color)]
  const edge = render([{ t: '│', fg: b.color }], 1)
  for (let i = 0; i < b.h - 2; i++) {
    const bg = b.rowBg?.(i)
    lines.push(edge + render(b.body[i] ?? [], inner, bg === undefined ? {} : { bg }) + edge)
  }
  lines.push(border('╰', '╯', b.footer ?? [], [], b.w, b.color))
  return lines
}

export function hjoin(a: readonly string[], b: readonly string[]): string[] {
  return a.map((line, i) => line + (b[i] ?? ''))
}
