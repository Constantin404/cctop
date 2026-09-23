// Reads what Claude Code already writes to disk: the live-session registry (~/.claude/sessions),
// background-job state (~/.claude/jobs), subagent transcripts, and the usage limits our status
// line tap caches (~/.claude/cctop/sl). Nothing here writes to Claude Code's files.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { base } from './fmt.ts'
import { JOBS, PROJECTS, SESSIONS, SL } from './paths.ts'
import { clean } from './term.ts'

export type Phase = 'working' | 'compacting' | 'input' | 'failed' | 'done' | 'idle'

export interface SubAgent {
  id: string
  type: string
  desc: string
  startedAt: number
}

export interface Agent {
  key: string
  pid: number
  sessionId: string
  jobId: string | null
  kind: 'bg' | 'cli'
  name: string
  cwd: string
  phase: Phase
  /** When the current phase began. */
  since: number
  startedAt: number
  detail: string | null
  result: string | null
  tokens: number | null
  /** In-flight background tasks (subagents, shells, monitors) as reported by the job. */
  inFlight: number
  subs: SubAgent[]
  ctx: number | null
  model: string | null
}

export interface Limit {
  pct: number
  resetsAt: number
}

export interface Usage {
  five: Limit | null
  week: Limit | null
  spend: Limit | null
  at: number
  sessionId: string
}

export interface Snapshot {
  at: number
  agents: Agent[]
  usage: Usage | null
}

export type Rec = Record<string, unknown>

export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

export function str(o: Rec, k: string): string | null {
  const v = o[k]
  return typeof v === 'string' ? v : null
}

export function num(o: Rec, k: string): number | null {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function readJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function ls(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const cleanOrNull = (s: string | null): string | null => (s ? clean(s) || null : null)

export const JOB_ID = /^[0-9a-f]{8}$/
const SESSION_ID = /^[0-9a-f-]{36}$/

const ORDER: Record<Phase, number> = { input: 0, working: 1, compacting: 1, failed: 2, done: 3, idle: 4 }

export const busy = (p: Phase): boolean => p === 'working' || p === 'compacting'

function jobPhase(state: string | null): Phase {
  switch (state) {
    case 'working':
      return 'working'
    case 'blocked':
      return 'input'
    case 'failed':
      return 'failed'
    case 'done':
      return 'done'
    default:
      return 'idle'
  }
}

function statusPhase(status: string | null): Phase | null {
  switch (status) {
    case 'busy':
    case 'starting':
      return 'working'
    case 'compacting':
      return 'compacting'
    case 'waiting':
    case 'blocked':
      return 'input'
    case 'idle':
      return 'idle'
    case 'done':
      return 'done'
    default:
      // 'shell' is the agent-view host itself, 'exited' is gone.
      return null
  }
}

function time(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** True when a subagent transcript ends on a final assistant turn. */
function transcriptFinished(p: string, size: number): boolean {
  const len = Math.min(size, 256 * 1024)
  if (len === 0) return false
  const buf = Buffer.alloc(len)
  let fd: number | null = null
  try {
    fd = openSync(p, 'r')
    readSync(fd, buf, 0, len, size - len)
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
  const lines = buf.toString('utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]?.trim()
    if (!raw) continue
    let rec: unknown
    try {
      rec = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isRec(rec)) continue
    const type = str(rec, 'type')
    if (type === 'user') return false
    if (type === 'assistant') {
      const msg = rec['message']
      const stop = isRec(msg) ? str(msg, 'stop_reason') : null
      return stop === 'end_turn' || stop === 'stop_sequence'
    }
  }
  return false
}

interface SlStats {
  ctx: number | null
  model: string | null
}

function limit(v: unknown): Limit | null {
  if (!isRec(v)) return null
  const pct = num(v, 'used_percentage')
  const resets = num(v, 'resets_at')
  return pct === null || resets === null ? null : { pct, resetsAt: resets * 1000 }
}

/** Newest window wins; within one window usage only grows, so the highest reading is current. */
function freshest(a: Limit | null, b: Limit | null): Limit | null {
  if (!a || !b) return a ?? b
  if (Math.abs(a.resetsAt - b.resetsAt) > 120_000) return a.resetsAt > b.resetsAt ? a : b
  return a.pct >= b.pct ? a : b
}

/**
 * Usage limits across all sessions' status lines, plus per-session context stats. Each session
 * only knows the limits from its own last API response, so the sessions are merged per window.
 */
function readStatusline(): { usage: Usage | null; stats: Map<string, SlStats> } {
  const stats = new Map<string, SlStats>()
  let usage: Usage | null = null
  for (const f of ls(SL)) {
    if (!f.endsWith('.json')) continue
    const e = readJson(join(SL, f))
    if (!isRec(e)) continue
    const sid = str(e, 'session_id')
    if (!sid) continue
    const at = (num(e, 'at') ?? 0) * 1000
    stats.set(sid, { ctx: num(e, 'context'), model: cleanOrNull(str(e, 'model')) })
    const rl = e['rate_limits']
    if (!isRec(rl)) continue
    const five = limit(rl['five_hour'])
    const week = limit(rl['seven_day'])
    const spend = limit(rl['spend_limit'])
    if (!five && !week && !spend) continue
    usage = usage
      ? { five: freshest(usage.five, five), week: freshest(usage.week, week), spend: freshest(usage.spend, spend), at: Math.max(usage.at, at), sessionId: at > usage.at ? sid : usage.sessionId }
      : { five, week, spend, at, sessionId: sid }
  }
  return { usage, stats }
}

interface SubFile {
  mtimeMs: number
  size: number
  finished: boolean
}

export class Collector {
  private seen = new Map<string, { phase: Phase; since: number }>()
  private subDirs = new Map<string, { dir: string | null; checked: number }>()
  private subFiles = new Map<string, SubFile>()
  private metas = new Map<string, { type: string; desc: string }>()
  private touched = new Set<string>()

  collect(now = Date.now()): Snapshot {
    const { usage, stats } = readStatusline()
    const agents: Agent[] = []
    for (const f of ls(SESSIONS)) {
      if (!f.endsWith('.json')) continue
      const s = readJson(join(SESSIONS, f))
      if (!isRec(s) || s['spare'] === true) continue
      const pid = num(s, 'pid')
      if (pid === null || !alive(pid)) continue
      const a = this.agent(s, pid, now, stats)
      if (a) agents.push(a)
    }
    const live = new Set(agents.map((a) => a.key))
    for (const k of this.seen.keys()) if (!live.has(k)) this.seen.delete(k)
    // The daemon runs for weeks: forget sessions and subagent files that are gone.
    const sessions = new Set(agents.map((a) => a.sessionId))
    for (const k of this.subDirs.keys()) if (!sessions.has(k)) this.subDirs.delete(k)
    for (const k of this.subFiles.keys()) if (!this.touched.has(k)) this.subFiles.delete(k)
    for (const k of this.metas.keys()) if (!this.touched.has(k.replace(/\.meta\.json$/, '.jsonl'))) this.metas.delete(k)
    this.touched.clear()
    agents.sort((x, y) => ORDER[x.phase] - ORDER[y.phase] || (busy(x.phase) ? x.startedAt - y.startedAt : y.since - x.since))
    return { at: now, agents, usage }
  }

  private agent(s: Rec, pid: number, now: number, stats: Map<string, SlStats>): Agent | null {
    const kindRaw = str(s, 'kind')
    const kind = kindRaw === 'bg' ? 'bg' : kindRaw === 'interactive' ? 'cli' : null
    if (!kind) return null
    const sessionId = str(s, 'sessionId') ?? ''
    const status = str(s, 'status')
    const statusAt = num(s, 'statusUpdatedAt') ?? num(s, 'updatedAt') ?? now
    const rawJob = str(s, 'jobId')
    const jobId = rawJob && JOB_ID.test(rawJob) ? rawJob : null
    const cwd = clean(str(s, 'cwd') ?? '')
    let name = clean(str(s, 'name') ?? '')
    let phase = statusPhase(status)
    let detail: string | null = null
    let result: string | null = null
    let tokens: number | null = null
    let inFlight = 0

    if (kind === 'bg' && jobId) {
      const j = readJson(join(JOBS, jobId, 'state.json'))
      if (isRec(j)) {
        const jp = jobPhase(str(j, 'state'))
        const jobAt = time(j['updatedAt']) ?? 0
        // A reply to a finished job flips the session to busy before the job state catches up.
        phase = status === 'busy' && !busy(jp) && statusAt > jobAt ? 'working' : jp
        detail = cleanOrNull(str(j, 'detail'))
        const out = j['output']
        result = isRec(out) ? cleanOrNull(str(out, 'result')) : null
        tokens = num(j, 'tokens')
        const fl = j['inFlight']
        inFlight = isRec(fl) ? (num(fl, 'tasks') ?? 0) : 0
        name = clean(str(j, 'name') ?? '') || name
      }
    }
    if (!phase) return null

    const key = jobId ?? (sessionId || String(pid))
    const prev = this.seen.get(key)
    const since = !prev ? statusAt : prev.phase !== phase ? now : prev.since
    this.seen.set(key, { phase, since })
    const st = stats.get(sessionId)
    return {
      key,
      pid,
      sessionId,
      jobId,
      kind,
      name: name || base(cwd) || String(pid),
      cwd,
      phase,
      since,
      startedAt: num(s, 'startedAt') ?? now,
      detail,
      result,
      tokens,
      inFlight,
      subs: SESSION_ID.test(sessionId) ? this.subs(sessionId, phase, now) : [],
      ctx: st?.ctx ?? null,
      model: st?.model ?? null,
    }
  }

  private subDir(sessionId: string, now: number): string | null {
    const hit = this.subDirs.get(sessionId)
    if (hit && (hit.dir || now - hit.checked < 20_000)) return hit.dir
    let dir: string | null = null
    for (const proj of ls(PROJECTS)) {
      const d = join(PROJECTS, proj, sessionId, 'subagents')
      if (existsSync(d)) {
        dir = d
        break
      }
    }
    this.subDirs.set(sessionId, { dir, checked: now })
    return dir
  }

  private meta(p: string): { type: string; desc: string } {
    const hit = this.metas.get(p)
    if (hit) return hit
    const m = readJson(p)
    if (!isRec(m)) return { type: 'agent', desc: '' }
    const v = { type: clean(str(m, 'agentType') ?? 'agent'), desc: clean(str(m, 'description') ?? '') }
    this.metas.set(p, v)
    return v
  }

  private subs(sessionId: string, parent: Phase, now: number): SubAgent[] {
    const dir = this.subDir(sessionId, now)
    if (!dir) return []
    const out: SubAgent[] = []
    for (const f of ls(dir)) {
      if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue
      const p = join(dir, f)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      this.touched.add(p)
      const quiet = now - st.mtimeMs
      // A transcript that stopped moving long ago belongs to a subagent that was killed or lost.
      if (quiet > 30 * 60_000 || (quiet > 10 * 60_000 && !busy(parent))) continue
      const hit = this.subFiles.get(p)
      let finished: boolean
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) finished = hit.finished
      else {
        finished = transcriptFinished(p, st.size)
        this.subFiles.set(p, { mtimeMs: st.mtimeMs, size: st.size, finished })
      }
      if (finished) continue
      const m = this.meta(p.slice(0, -'.jsonl'.length) + '.meta.json')
      out.push({ id: f.slice('agent-'.length, -'.jsonl'.length), type: m.type, desc: m.desc, startedAt: st.birthtimeMs || st.ctimeMs })
    }
    return out.sort((a, b) => a.startedAt - b.startedAt)
  }
}
