import { busy, Collector } from './collect.ts'
import { base, dur, resetIn, tokens } from './fmt.ts'
import { setLang, t } from './i18n.ts'
import { install, uninstall } from './install.ts'
import { daemon, daemonPid, send } from './notify.ts'
import { loadConfig, loadEvents, loadSamples } from './store.ts'
import { frame, runTui, type Ui } from './tui.ts'

function status(json: boolean): void {
  const snap = new Collector().collect()
  if (json) {
    console.log(JSON.stringify(snap, null, 2))
    return
  }
  const now = snap.at
  const u = snap.usage
  const lim = (label: string, l: { pct: number; resetsAt: number } | null | undefined): string =>
    l ? `${label} ${Math.round(l.resetsAt > now ? l.pct : 0)}% (reset ${resetIn(l.resetsAt, now)})` : `${label} --`
  console.log(`usage  ${lim('5h', u?.five)} · ${lim('7d', u?.week)} · ${u ? dur(now - u.at) : t().statusNoData}`)
  const working = snap.agents.filter((a) => busy(a.phase)).length
  const subs = snap.agents.reduce((n, a) => n + a.subs.length, 0)
  console.log(t().statusFleet(working, subs, snap.agents.length, daemonPid() ? 'daemon' : t().statusNoDaemon))
  for (const a of snap.agents) {
    console.log(`  ${a.phase.padEnd(10)} ${a.name.padEnd(32)} ${a.kind.padEnd(3)} ${base(a.cwd).padEnd(22)} ${dur(now - a.since).padStart(6)} ${tokens(a.tokens).padStart(6)}`)
    for (const s of a.subs) console.log(`  ${''.padEnd(10)} ◦ ${s.type} · ${s.desc}`)
  }
}

/** Prints one rendered frame, for checking the layout without a tty. */
function printFrame(w: number, h: number): void {
  const snap = new Collector().collect()
  const ui: Ui = { sel: null, scroll: 0, flash: null, hist: [0, 1, 1, 2, 3, 3, 2, 4, 3, 3, 5, 4, 3, 3, 2, 3, 4, 4, 3, 3], spin: 0, order: [] }
  const lines = frame({ snap, ui, cfg: loadConfig(), owner: daemonPid() ? 'daemon' : 'tui', events: loadEvents(), samples: loadSamples(), w, h })
  process.stdout.write(lines.join('\n') + '\n')
}

const cfg = loadConfig()
if (cfg.lang) setLang(cfg.lang)

const [cmd, ...rest] = process.argv.slice(2)
switch (cmd) {
  case undefined:
    if (process.stdout.isTTY && process.stdin.isTTY) runTui()
    else status(false)
    break
  case 'status':
    status(rest.includes('--json'))
    break
  case 'frame':
    printFrame(Number(rest[0]) || 120, Number(rest[1]) || 36)
    break
  case 'daemon':
    daemon()
    break
  case 'install':
    install({ daemon: !rest.includes('--no-daemon') })
    break
  case 'uninstall':
    uninstall()
    break
  case 'test-notify':
    send({ at: Date.now(), key: 'test', name: 'cctop', kind: 'test', text: t().testText }, cfg)
    console.log(t().testSent)
    break
  default:
    process.stdout.write(t().help)
    process.exit(cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 1)
}
