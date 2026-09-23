// Turns phase changes into finish notifications. Exactly one process owns notifications: the
// launchd daemon when it runs, otherwise an open cctop window, so nothing fires twice.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, busy, Collector, type Agent, type Phase, type Snapshot } from './collect.ts'
import { base, dur } from './fmt.ts'
import { DAEMON_PID, HOME, SL } from './paths.ts'
import { appendEvent, loadConfig, readText, recordUsage, type Config, type Event, type EventKind } from './store.ts'

export const EVENT_STYLE: Record<EventKind, { glyph: string; label: string }> = {
  done: { glyph: '✓', label: 'fertig' },
  idle: { glyph: '✓', label: 'fertig' },
  input: { glyph: '◆', label: 'wartet auf dich' },
  failed: { glyph: '✗', label: 'fehlgeschlagen' },
  test: { glyph: '●', label: 'test' },
}

function transition(a: Agent, from: Phase, workedMs: number, cfg: Config): Omit<Event, 'at' | 'key' | 'name'> | null {
  if (a.phase === 'input') return { kind: 'input', text: a.detail ?? 'braucht eine Entscheidung' }
  if (a.phase === 'failed') return { kind: 'failed', text: a.result ?? a.detail ?? '' }
  if (!busy(from)) return null
  if (a.phase === 'done') return { kind: 'done', text: a.result ?? a.detail ?? base(a.cwd) }
  // Background jobs announce the end of their work through done / input / failed.
  if (a.phase === 'idle' && a.kind === 'cli' && workedMs >= cfg.minWorkSec * 1000)
    return { kind: 'idle', text: `Antwort bereit · ${base(a.cwd)} · ${dur(workedMs)}` }
  return null
}

export class Watcher {
  private prev = new Map<string, { phase: Phase; workSince: number | null }>()
  private primed = false

  /** Events for every phase change since the previous snapshot; the first snapshot is the baseline. */
  step(snap: Snapshot, cfg: Config): Event[] {
    const events: Event[] = []
    const live = new Set<string>()
    for (const a of snap.agents) {
      live.add(a.key)
      const p = this.prev.get(a.key)
      const workSince = busy(a.phase) ? (p?.workSince ?? (p ? snap.at : a.since)) : null
      if (this.primed && p && p.phase !== a.phase) {
        const worked = p.workSince === null ? 0 : snap.at - p.workSince
        const ev = transition(a, p.phase, worked, cfg)
        if (ev) events.push({ ...ev, at: snap.at, key: a.key, name: a.name })
      }
      this.prev.set(a.key, { phase: a.phase, workSince })
    }
    for (const k of this.prev.keys()) if (!live.has(k)) this.prev.delete(k)
    this.primed = true
    return events
  }
}

let notifierBin: string | null | undefined

function terminalNotifier(): string | null {
  if (notifierBin === undefined)
    notifierBin = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'].find((p) => existsSync(p)) ?? null
  return notifierBin
}

/** Posts a macOS notification. Text goes in as argv, never spliced into a script. */
export function send(e: Event, cfg: Config): void {
  const style = EVENT_STYLE[e.kind]
  const subtitle = `${style.glyph} ${style.label} · ${e.name}`
  const body = (e.text || ' ').slice(0, 240)
  const sound = e.kind === 'input' ? cfg.soundInput : cfg.soundDone
  const viaScript = (): void => {
    execFile(
      '/usr/bin/osascript',
      ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title "Claude Code" subtitle (item 2 of argv) sound name (item 3 of argv)', '-e', 'end run', body, subtitle, sound],
      () => {},
    )
  }
  const tn = terminalNotifier()
  if (!tn) return viaScript()
  // A leading dash or bracket would be read as a flag / group syntax by terminal-notifier.
  const safe = /^[-[]/.test(body) ? `​${body}` : body
  // terminal-notifier focuses Terminal on click; until macOS allows it, osascript takes over.
  execFile(tn, ['-title', 'Claude Code', '-subtitle', subtitle, '-message', safe, '-sound', sound, '-group', `cctop-${e.key}`, '-activate', 'com.apple.Terminal'], (err) => {
    if (err) viaScript()
  })
}

export function daemonPid(): number | null {
  const raw = readText(DAEMON_PID)
  const pid = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null
}

export function emit(events: readonly Event[], cfg: Config): void {
  for (const e of events) {
    appendEvent(e)
    if (cfg.notify) send(e, cfg)
  }
}

function pruneStatusline(now: number): void {
  let names: string[] = []
  try {
    names = readdirSync(SL)
  } catch {
    return
  }
  for (const f of names) {
    const p = join(SL, f)
    try {
      if (now - statSync(p).mtimeMs > 3 * 86400_000) rmSync(p)
    } catch {
      // Already gone.
    }
  }
}

/** Headless notifier, run by launchd. */
export function daemon(): void {
  mkdirSync(HOME, { recursive: true })
  const other = daemonPid()
  if (other && other !== process.pid) {
    console.error(`cctop daemon läuft schon (pid ${other})`)
    process.exit(0)
  }
  writeFileSync(DAEMON_PID, String(process.pid))
  const collector = new Collector()
  const watcher = new Watcher()
  let lastPrune = 0
  const tick = (): void => {
    try {
      const cfg = loadConfig()
      const snap = collector.collect()
      emit(watcher.step(snap, cfg), cfg)
      recordUsage(snap.usage)
      if (snap.at - lastPrune > 3600_000) {
        pruneStatusline(snap.at)
        lastPrune = snap.at
      }
    } catch (e) {
      console.error(new Date().toISOString(), e)
    }
  }
  const stop = (): void => {
    if (readText(DAEMON_PID) === String(process.pid)) rmSync(DAEMON_PID, { force: true })
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  tick()
  setInterval(tick, 2000)
  console.error(`${new Date().toISOString()} cctop daemon läuft (pid ${process.pid})`)
}
