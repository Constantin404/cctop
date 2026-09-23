// The full-screen view: usage limits and fleet activity on top, sessions in the middle,
// the notification log at the bottom. Pure `frame()` builds the lines; `runTui()` owns the tty.

import { execFile } from 'node:child_process'
import { busy, Collector, type Agent, type Limit, type Phase, type Snapshot } from './collect.ts'
import { base, clock, dur, resetIn, tokens } from './fmt.ts'
import { daemonPid, emit, EVENT_STYLE, send, Watcher } from './notify.ts'
import { loadConfig, loadEvents, loadSamples, project, recordUsage, saveConfig, type Config, type Event, type EventKind, type Sample } from './store.ts'
import { BORDER, box, C, COOL, fit, grad, graph, HEAT, hjoin, meter, render, type Seg } from './term.ts'

export type Owner = 'daemon' | 'tui'

export interface Ui {
  sel: string | null
  scroll: number
  flash: { text: string; until: number } | null
  hist: number[]
  spin: number
  /** Selectable agent keys in display order, written by frame(). */
  order: string[]
}

export interface FrameInput {
  snap: Snapshot
  ui: Ui
  cfg: Config
  owner: Owner
  events: readonly Event[]
  samples: readonly Sample[]
  w: number
  h: number
}

const PHASE: Record<Phase, { glyph: string; label: string; fg: number }> = {
  working: { glyph: '●', label: 'work', fg: C.work },
  compacting: { glyph: '◌', label: 'compact', fg: C.compact },
  input: { glyph: '◆', label: 'input', fg: C.input },
  failed: { glyph: '✗', label: 'fail', fg: C.failed },
  done: { glyph: '✓', label: 'done', fg: C.done },
  idle: { glyph: '○', label: 'idle', fg: C.idle },
}

const EVENT_FG: Record<EventKind, number> = { done: C.done, idle: C.done, input: C.input, failed: C.failed, test: C.sub }

const SPIN = ['◐', '◓', '◑', '◒'] as const

export function activeCount(snap: Snapshot): number {
  return snap.agents.reduce((n, a) => n + (busy(a.phase) ? 1 : 0) + a.subs.length, 0)
}

function limitRow(label: string, sub: string, lim: Limit | null, iw: number, now: number): Seg[] {
  const expired = lim !== null && lim.resetsAt <= now
  const pct = lim && !expired ? lim.pct : 0
  const pctText = lim ? `${Math.round(pct)}%` : '--'
  const reset = !lim ? '' : expired ? '↻ neu' : `↻ ${resetIn(lim.resetsAt, now)}`
  const mw = Math.max(4, iw - 4 - 8 - 6 - 12)
  return [
    { t: ` ${label} `, fg: C.title, bold: true },
    { t: fit(sub, 8), fg: C.dim },
    ...meter(pct, mw),
    { t: fit(pctText, 6, 'right'), fg: lim ? grad(HEAT, pct / 100) : C.faint, bold: true },
    { t: '  ' + fit(reset, 10), fg: C.dim },
  ]
}

function usageBox(f: FrameInput, w: number, h: number): string[] {
  const { snap, samples } = f
  const now = snap.at
  const u = snap.usage
  const iw = w - 2
  const body: Seg[][] = [limitRow('5h', 'session', u?.five ?? null, iw, now), limitRow('7d', 'woche', u?.week ?? null, iw, now)]
  if (!u) {
    body.push([{ t: ' noch keine werte: kommen mit der nächsten antwort einer session', fg: C.dim }])
    body.push([{ t: ' (statusline-tap nötig: cctop install)', fg: C.faint }])
  } else {
    const five = u.five && u.five.resetsAt > now ? u.five : null
    const p = five ? project(samples, five.pct, five.resetsAt, now) : null
    if (!five) body.push([{ t: ' 5h-fenster zurückgesetzt, neue werte mit der nächsten antwort', fg: C.dim }])
    else if (!p) body.push([{ t: ' tempo: sammle messpunkte …', fg: C.faint }])
    else {
      const rate: Seg = { t: ` tempo ${p.rate >= 0 ? '+' : ''}${p.rate.toFixed(1)}%/h`, fg: C.text }
      const atReset = five.pct + Math.max(0, p.rate) * ((five.resetsAt - now) / 3600_000)
      body.push([
        rate,
        p.eta !== null && atReset >= 100
          ? { t: ` → voll in ~${dur(p.eta)}, vor dem reset`, fg: C.failed }
          : { t: ` → ~${Math.round(atReset)}% beim reset`, fg: atReset >= 85 ? C.input : C.work },
      ])
    }
    const age = now - u.at
    body.push([{ t: ` stand vor ${dur(age)}${age > 15 * 60_000 ? ' (alt: keine session aktiv)' : ''} · quelle statusline`, fg: C.faint }])
  }
  return box({ title: 'usage', color: BORDER.usage, w, h, body, tr: [{ t: clock(now, true), fg: C.text }] })
}

function fleetBox(f: FrameInput, w: number, h: number): string[] {
  const { snap, ui, cfg, owner } = f
  const count = (p: (a: Agent) => boolean): number => snap.agents.filter(p).length
  const subs = snap.agents.reduce((n, a) => n + a.subs.length, 0)
  const stat = (glyph: string, fg: number, n: number, label: string): Seg[] => [
    { t: ` ${glyph} `, fg },
    { t: String(n), fg: n ? C.title : C.faint, bold: n > 0 },
    { t: ` ${label}  `, fg: C.dim },
  ]
  const body: Seg[][] = [
    [
      ...stat('●', C.work, count((a) => busy(a.phase)), 'work'),
      ...stat('◆', C.input, count((a) => a.phase === 'input'), 'input'),
      ...stat('◦', C.sub, subs, 'sub'),
      ...stat('○', C.idle, count((a) => !busy(a.phase) && a.phase !== 'input'), 'idle'),
    ],
  ]
  const rows = h - 3
  const cols = Math.max(4, w - 2 - 5)
  const max = Math.max(4, ...ui.hist)
  graph(ui.hist, max, cols, rows, COOL).forEach((g, i) => {
    const axis = i === 0 ? String(max) : i === rows - 1 ? '0' : ''
    body.push([{ t: ' ' }, ...g, { t: fit(axis, 4, 'right'), fg: C.faint }])
  })
  const tr: Seg[] = cfg.notify
    ? [{ t: 'notify ', fg: C.dim }, { t: '●', fg: C.work }, { t: owner === 'daemon' ? ' daemon' : ' hier', fg: C.dim }]
    : [{ t: 'notify ', fg: C.dim }, { t: '○ aus', fg: C.failed }]
  return box({ title: 'fleet', color: BORDER.fleet, w, h, body, tr })
}

interface Row {
  segs: Seg[]
  key: string | null
}

function sessionsBox(f: FrameInput, w: number, h: number): string[] {
  const { snap, ui, cfg } = f
  const now = snap.at
  const iw = w - 2
  const agents = cfg.hideDone ? snap.agents.filter((a) => a.phase !== 'done' && a.phase !== 'idle') : snap.agents
  ui.order = agents.map((a) => a.key)
  if (!ui.sel || !ui.order.includes(ui.sel)) ui.sel = ui.order[0] ?? null

  const wide = iw >= 84
  const cw = { st: 10, kind: 4, time: 7, ctx: wide ? 5 : 0, tok: wide ? 7 : 0, sub: 4 }
  const rest = iw - 1 - cw.st - cw.kind - cw.time - cw.ctx - cw.tok - cw.sub
  const dirW = iw >= 64 ? Math.min(24, Math.max(10, Math.floor(rest * 0.3))) : 0
  // Left-packed: past ~42 columns a wider name column only pushes the numbers away.
  const nameW = Math.min(rest - dirW, 42)
  const indent = ' '.repeat(1 + cw.st)

  const header: Seg[] = [
    {
      t:
        ' ' +
        fit('state', cw.st) +
        fit('name', nameW) +
        fit('dir', dirW) +
        fit('kind', cw.kind) +
        fit('time', cw.time - 1, 'right') +
        ' ' +
        (cw.ctx ? fit('ctx', cw.ctx - 1, 'right') + ' ' : '') +
        (cw.tok ? fit('tok', cw.tok - 1, 'right') + ' ' : '') +
        fit('sub', cw.sub - 1, 'right'),
      fg: C.faint,
    },
  ]

  const rows: Row[] = []
  for (const a of agents) {
    const ps = PHASE[a.phase]
    const quiet = a.phase === 'idle' || a.phase === 'done'
    const sel = a.key === ui.sel
    rows.push({
      key: a.key,
      segs: [
        { t: ' ' },
        { t: (busy(a.phase) ? (SPIN[ui.spin % SPIN.length] ?? ps.glyph) : ps.glyph) + ' ', fg: ps.fg },
        { t: fit(ps.label, cw.st - 2), fg: ps.fg },
        { t: fit(a.name, nameW - 1) + ' ', fg: quiet ? C.dim : C.text, bold: sel },
        { t: fit(base(a.cwd), dirW), fg: C.faint },
        { t: fit(a.kind, cw.kind), fg: C.faint },
        { t: fit(dur(now - a.since), cw.time - 1, 'right') + ' ', fg: C.dim },
        ...(cw.ctx ? [{ t: fit(a.ctx === null ? '' : `${Math.round(a.ctx)}%`, cw.ctx - 1, 'right') + ' ', fg: a.ctx === null ? C.faint : grad(HEAT, a.ctx / 100) }] : []),
        ...(cw.tok ? [{ t: fit(tokens(a.tokens), cw.tok - 1, 'right') + ' ', fg: C.dim }] : []),
        { t: fit(a.subs.length ? String(a.subs.length) : '', cw.sub - 1, 'right'), fg: C.sub, bold: true },
      ],
    })
    const tasks = a.inFlight > a.subs.length ? ` · ${a.inFlight - a.subs.length} task${a.inFlight - a.subs.length > 1 ? 's' : ''} im hintergrund` : ''
    const note =
      a.phase === 'done' ? a.result ?? a.detail : a.phase === 'idle' ? null : a.detail ? a.detail + tasks : tasks ? tasks.slice(3) : null
    if (note) rows.push({ key: null, segs: [{ t: indent + '└ ', fg: C.line }, { t: note, fg: a.phase === 'input' ? C.input : a.phase === 'failed' ? C.failed : C.dim }] })
    for (const s of a.subs)
      rows.push({
        key: null,
        segs: [
          { t: indent + '◦ ', fg: C.sub },
          { t: s.type, fg: C.sub },
          { t: ` ${dur(now - s.startedAt)}`, fg: C.faint },
          ...(s.desc ? [{ t: ' · ', fg: C.line }, { t: s.desc, fg: C.dim }] : []),
        ],
      })
  }

  const visible = h - 3
  const selIdx = rows.findIndex((r) => r.key !== null && r.key === ui.sel)
  if (selIdx >= 0) {
    if (selIdx < ui.scroll) ui.scroll = selIdx
    if (selIdx >= ui.scroll + visible) ui.scroll = selIdx - visible + 1
  }
  ui.scroll = Math.max(0, Math.min(ui.scroll, rows.length - visible))
  const shown = rows.slice(ui.scroll, ui.scroll + visible)
  const body: Seg[][] = [header, ...shown.map((r) => r.segs)]
  if (!agents.length)
    body.push([{ t: cfg.hideDone && snap.agents.length ? ' nichts aktiv (d zeigt alle)' : ' keine laufenden Claude-Sessions', fg: C.dim }])

  const more = rows.length > visible ? ` ${ui.scroll + 1}-${Math.min(rows.length, ui.scroll + visible)}/${rows.length}` : ''
  const hot = (k: string, label: string): Seg[] => [
    { t: k, fg: C.hot, bold: true },
    { t: ` ${label}`, fg: C.dim },
  ]
  return box({
    title: 'sessions',
    color: BORDER.agents,
    w,
    h,
    body,
    tr: [{ t: `${agents.length}${agents.length === snap.agents.length ? '' : '/' + snap.agents.length} live${more}`, fg: C.dim }],
    footer: [hot('↑↓', 'wählen'), hot('⏎', 'attach'), hot('n', 'notify'), hot('d', cfg.hideDone ? 'alle' : 'nur aktive'), hot('t', 'test'), hot('q', 'quit')],
    rowBg: (i) => (i > 0 && shown[i - 1]?.key === ui.sel && ui.sel !== null ? C.selBg : undefined),
  })
}

function logBox(f: FrameInput, w: number, h: number): string[] {
  const { events, ui, snap } = f
  const body: Seg[][] = events.slice(0, h - 2).map((e) => {
    const st = EVENT_STYLE[e.kind]
    const fg = EVENT_FG[e.kind]
    return [
      { t: ` ${clock(e.at)}  `, fg: C.faint },
      { t: `${st.glyph} `, fg },
      { t: fit(st.label, 16), fg },
      { t: fit(e.name, 28) + ' ', fg: C.text },
      { t: e.text, fg: C.dim },
    ]
  })
  if (!body.length) body.push([{ t: ' noch keine meldungen: erscheinen, sobald eine session fertig ist oder auf dich wartet', fg: C.faint }])
  const flash = ui.flash && ui.flash.until > snap.at ? ui.flash.text : null
  return box({ title: 'log', color: BORDER.log, w, h, body, ...(flash ? { tr: [{ t: flash, fg: C.input }] } : {}) })
}

export function frame(f: FrameInput): string[] {
  const { w, h } = f
  if (w < 60 || h < 16) {
    const msg = render([{ t: ` cctop braucht mindestens 60×16 (jetzt ${w}×${h})`, fg: C.dim }], w)
    return [msg, ...Array.from({ length: h - 1 }, () => render([], w))]
  }
  const side = w >= 96
  const uw = side ? Math.floor(w * 0.56) : w
  const top = side ? hjoin(usageBox(f, uw, 6), fleetBox(f, w - uw, 6)) : [...usageBox(f, w, 6), ...fleetBox(f, w, 5)]
  const logH = h >= 34 ? 8 : h >= 26 ? 6 : 0
  const sessH = Math.max(5, h - top.length - logH)
  const lines = [...top, ...sessionsBox(f, w, sessH), ...(logH ? logBox(f, w, logH) : [])]
  return lines.slice(0, h)
}

export function runTui(): void {
  const out = process.stdout
  const inp = process.stdin
  const collector = new Collector()
  const watcher = new Watcher()
  const ui: Ui = { sel: null, scroll: 0, flash: null, hist: [], spin: 0, order: [] }
  let cfg = loadConfig()
  let snap = collector.collect()
  let owner: Owner = daemonPid() ? 'daemon' : 'tui'
  let lastSample = 0
  watcher.step(snap, cfg)

  const draw = (): void => {
    const lines = frame({ snap, ui, cfg, owner, events: loadEvents(), samples: loadSamples(), w: out.columns || 100, h: out.rows || 30 })
    out.write('\x1b[?2026h' + lines.map((l, i) => `\x1b[${i + 1};1H${l}`).join('') + '\x1b[?2026l')
  }
  const flash = (text: string): void => {
    ui.flash = { text, until: Date.now() + 4000 }
  }
  const tick = (): void => {
    cfg = loadConfig()
    snap = collector.collect()
    owner = daemonPid() ? 'daemon' : 'tui'
    const events = watcher.step(snap, cfg)
    if (owner === 'tui') {
      emit(events, cfg)
      recordUsage(snap.usage)
    }
    if (snap.at - lastSample >= 3000) {
      ui.hist.push(activeCount(snap))
      if (ui.hist.length > 2000) ui.hist.splice(0, ui.hist.length - 2000)
      lastSample = snap.at
    }
    ui.spin++
    draw()
  }

  const move = (d: number): void => {
    const i = ui.sel ? ui.order.indexOf(ui.sel) : -1
    const next = ui.order[Math.max(0, Math.min(ui.order.length - 1, i + d))]
    if (next) ui.sel = next
  }
  const attach = (): void => {
    const a = snap.agents.find((x) => x.key === ui.sel)
    if (!a) return
    if (a.kind !== 'bg' || !a.jobId) return flash('interaktive session: läuft in ihrem eigenen terminal-tab')
    // jobId is validated as 8 hex chars by the collector, so it is safe inside the shell command.
    execFile(
      '/usr/bin/osascript',
      ['-e', 'on run argv', '-e', 'tell application "Terminal"', '-e', 'do script ("claude attach " & item 1 of argv)', '-e', 'activate', '-e', 'end tell', '-e', 'end run', a.jobId],
      () => {},
    )
    flash(`attach ${a.jobId} → neues terminal-fenster`)
  }

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    out.write('\x1b[?7h\x1b[?25h\x1b[?1049l')
    if (inp.isTTY) inp.setRawMode(false)
  }
  const quit = (): void => {
    restore()
    process.exit(0)
  }

  inp.on('data', (buf: Buffer) => {
    const k = buf.toString()
    if (k === 'q' || k === '\x03' || k === '\x1b') return quit()
    if (k === '\x1b[A' || k === 'k') move(-1)
    else if (k === '\x1b[B' || k === 'j') move(1)
    else if (k === '\r') attach()
    else if (k === 'n') {
      cfg = saveConfig({ notify: !cfg.notify })
      flash(cfg.notify ? 'notifications an' : 'notifications aus')
    } else if (k === 'd') cfg = saveConfig({ hideDone: !cfg.hideDone })
    else if (k === 't') {
      send({ at: Date.now(), key: 'test', name: 'cctop', kind: 'test', text: 'So sieht eine Meldung aus, wenn eine Session fertig ist.' }, cfg)
      flash('test-meldung gesendet')
    }
    draw()
  })

  out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J')
  if (inp.isTTY) inp.setRawMode(true)
  inp.resume()
  out.on('resize', () => {
    out.write('\x1b[2J')
    draw()
  })
  process.on('SIGTERM', quit)
  process.on('SIGHUP', quit)
  process.on('exit', restore)
  process.on('uncaughtException', (e) => {
    restore()
    console.error(e)
    process.exit(1)
  })
  tick()
  setInterval(tick, 1000)
}
