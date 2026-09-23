// cctop's own small state: config, the notification event log and the usage sample log.

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isRec, num, readJson, str, type Usage } from './collect.ts'
import { CONFIG, EVENTS, HOME, USAGE_LOG } from './paths.ts'
import type { Lang } from './i18n.ts'
import { clean } from './term.ts'

export interface Config {
  notify: boolean
  /** Interactive sessions only notify when a turn ran at least this long. */
  minWorkSec: number
  soundDone: string
  soundInput: string
  hideDone: boolean
  /** UI language; null follows the system locale. */
  lang: Lang | null
  /** Bundle id of the terminal a notification click brings forward. */
  terminal: string
}

const DEFAULTS: Config = { notify: true, minWorkSec: 20, soundDone: 'Glass', soundInput: 'Funk', hideDone: false, lang: null, terminal: 'com.apple.Terminal' }

export function loadConfig(): Config {
  const c = readJson(CONFIG)
  if (!isRec(c)) return { ...DEFAULTS }
  return {
    notify: typeof c['notify'] === 'boolean' ? c['notify'] : DEFAULTS.notify,
    minWorkSec: num(c, 'minWorkSec') ?? DEFAULTS.minWorkSec,
    soundDone: str(c, 'soundDone') ?? DEFAULTS.soundDone,
    soundInput: str(c, 'soundInput') ?? DEFAULTS.soundInput,
    hideDone: typeof c['hideDone'] === 'boolean' ? c['hideDone'] : DEFAULTS.hideDone,
    lang: c['lang'] === 'de' || c['lang'] === 'en' ? c['lang'] : DEFAULTS.lang,
    terminal: str(c, 'terminal') ?? DEFAULTS.terminal,
  }
}

export function writeAtomic(path: string, data: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, path)
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch }
  writeAtomic(CONFIG, JSON.stringify(next, null, 2) + '\n')
  return next
}

/** Reads the last `bytes` of a file as complete lines. */
function tailLines(path: string, bytes: number): string[] {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    fd = openSync(path, 'r')
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    if (len < size) lines.shift()
    return lines.filter(Boolean)
  } catch {
    return []
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function append(path: string, rec: object, maxBytes: number, keepLines: number): void {
  mkdirSync(HOME, { recursive: true })
  appendFileSync(path, JSON.stringify(rec) + '\n')
  try {
    if (statSync(path).size > maxBytes) writeAtomic(path, tailLines(path, maxBytes).slice(-keepLines).join('\n') + '\n')
  } catch {
    // Trimming is housekeeping; a failed trim just retries on the next append.
  }
}

export type EventKind = 'done' | 'idle' | 'input' | 'failed' | 'test'

export interface Event {
  at: number
  key: string
  name: string
  kind: EventKind
  text: string
}

const KINDS: readonly EventKind[] = ['done', 'idle', 'input', 'failed', 'test']

export function appendEvent(e: Event): void {
  append(EVENTS, e, 256 * 1024, 500)
}

let eventsCache: { mtimeMs: number; events: Event[] } | null = null

/** Newest first. */
export function loadEvents(): Event[] {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(EVENTS).mtimeMs
  } catch {
    return []
  }
  if (eventsCache && eventsCache.mtimeMs === mtimeMs) return eventsCache.events
  const events: Event[] = []
  for (const line of tailLines(EVENTS, 32 * 1024)) {
    let r: unknown
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRec(r)) continue
    const kind = KINDS.find((k) => k === r['kind'])
    const at = num(r, 'at')
    if (!kind || at === null) continue
    events.push({ at, kind, key: clean(str(r, 'key') ?? ''), name: clean(str(r, 'name') ?? ''), text: clean(str(r, 'text') ?? '') })
  }
  events.reverse()
  eventsCache = { mtimeMs, events }
  return events
}

export interface Sample {
  at: number
  five: number | null
  fiveReset: number | null
  week: number | null
  weekReset: number | null
}

let lastSample: Sample | null | undefined

function readSamples(): Sample[] {
  const out: Sample[] = []
  for (const line of tailLines(USAGE_LOG, 128 * 1024)) {
    let r: unknown
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRec(r)) continue
    const at = num(r, 'at')
    if (at === null) continue
    out.push({ at, five: num(r, 'five'), fiveReset: num(r, 'fiveReset'), week: num(r, 'week'), weekReset: num(r, 'weekReset') })
  }
  return out
}

/** Appends a usage sample whenever the reported percentages change. */
export function recordUsage(u: Usage | null): void {
  if (!u) return
  if (lastSample === undefined) lastSample = readSamples().at(-1) ?? null
  const s: Sample = { at: u.at, five: u.five?.pct ?? null, fiveReset: u.five?.resetsAt ?? null, week: u.week?.pct ?? null, weekReset: u.week?.resetsAt ?? null }
  if (lastSample && lastSample.five === s.five && lastSample.week === s.week && lastSample.fiveReset === s.fiveReset) return
  if (lastSample && s.at <= lastSample.at) return
  append(USAGE_LOG, s, 512 * 1024, 4000)
  lastSample = s
}

let samplesCache: { mtimeMs: number; samples: Sample[] } | null = null

export function loadSamples(): Sample[] {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(USAGE_LOG).mtimeMs
  } catch {
    return []
  }
  if (samplesCache && samplesCache.mtimeMs === mtimeMs) return samplesCache.samples
  const samples = readSamples()
  samplesCache = { mtimeMs, samples }
  return samples
}

export interface Projection {
  /** Percentage points per hour. */
  rate: number
  /** Time until 100 % at that rate, null when usage is flat. */
  eta: number | null
}

/** Burn rate of the 5-hour window over the last hour of samples from the same window. */
export function project(samples: readonly Sample[], pct: number, resetsAt: number, now: number): Projection | null {
  const win = samples.filter((s) => s.five !== null && s.fiveReset !== null && Math.abs(s.fiveReset - resetsAt) < 120_000 && now - s.at < 3600_000)
  const first = win[0]
  const last = win[win.length - 1]
  if (!first || !last || first.five === null || last.five === null) return null
  const hours = (now - first.at) / 3600_000
  if (hours < 5 / 60) return null
  const rate = (Math.max(pct, last.five) - first.five) / hours
  return { rate, eta: rate > 0.5 ? ((100 - pct) / rate) * 3600_000 : null }
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
