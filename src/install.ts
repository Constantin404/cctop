// `cctop install` wires up to three things, all reversible with `cctop uninstall`:
//   1. ~/.local/bin/cctop symlink
//   2. the status line tap in front of the existing status line command (the only place Claude
//      Code exposes the 5-hour / weekly usage percentages)
//   3. a launchd agent running the notifier, so finish notifications work with no cctop open
// It also deploys a runtime copy (see RUNTIME) and records language and terminal in config.json.

import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { isRec, str } from './collect.ts'
import { detectLang, setLang, t } from './i18n.ts'
import { BIN_LINK, DAEMON_LOG, HOME, LABEL, LEGACY_LABELS, PLIST, ROOT, RUNTIME, SETTINGS, SL, STATUSLINE_NEXT, TAP } from './paths.ts'
import { loadConfig, readText, saveConfig, writeAtomic } from './store.ts'

const TAP_CMD = `bash "${TAP}"`
const MAC = process.platform === 'darwin'

/** Any cctop tap, including one from an older install location, so it is never chained to itself. */
const isTap = (cmd: string | null): boolean => cmd !== null && cmd.includes('cctop') && cmd.includes('statusline/tap.sh')

// TERM_PROGRAM (or TERM) → bundle id that a notification click brings forward.
const TERMINALS: Record<string, string> = {
  Apple_Terminal: 'com.apple.Terminal',
  'iTerm.app': 'com.googlecode.iterm2',
  ghostty: 'com.mitchellh.ghostty',
  WezTerm: 'com.github.wez.wezterm',
  WarpTerminal: 'dev.warp.Warp-Stable',
  vscode: 'com.microsoft.VSCode',
  Tabby: 'org.tabby',
  Hyper: 'co.zeit.hyper',
  'xterm-kitty': 'net.kovidgoyal.kitty',
  alacritty: 'org.alacritty',
}

function say(ok: boolean, msg: string): void {
  console.log(`${ok ? '  ✓' : '  ·'} ${msg}`)
}

function onPath(bin: string): boolean {
  return (process.env['PATH'] ?? '').split(delimiter).some((d) => d && existsSync(join(d, bin)))
}

function checks(): void {
  if (!onPath('jq')) say(false, t().needJq)
  if (MAC && !['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'].some((p) => existsSync(p))) say(false, t().noNotifier)
}

function recordEnvironment(): void {
  const cfg = loadConfig()
  const lang = cfg.lang ?? detectLang()
  setLang(lang)
  const terminal = TERMINALS[process.env['TERM_PROGRAM'] ?? ''] ?? TERMINALS[process.env['TERM'] ?? '']
  saveConfig({ lang, ...(terminal ? { terminal } : {}) })
}

function linkBin(): void {
  const target = join(ROOT, 'bin', 'cctop')
  const dir = dirname(BIN_LINK)
  try {
    const st = lstatSync(BIN_LINK)
    if (!st.isSymbolicLink()) return say(false, t().binExists(BIN_LINK))
    if (readlinkSync(BIN_LINK) === target) say(true, t().binLinked(dir))
    else {
      rmSync(BIN_LINK)
      symlinkSync(target, BIN_LINK)
      say(true, t().binCreated(BIN_LINK, target))
    }
  } catch {
    mkdirSync(dir, { recursive: true })
    symlinkSync(target, BIN_LINK)
    say(true, t().binCreated(BIN_LINK, target))
  }
  if (!(process.env['PATH'] ?? '').split(delimiter).includes(dir)) say(false, t().notOnPath(dir.replace(homedir(), '$HOME')))
}

function deploy(): void {
  if (ROOT === RUNTIME) return say(false, t().deploySkipped)
  rmSync(RUNTIME, { recursive: true, force: true })
  mkdirSync(RUNTIME, { recursive: true })
  for (const dir of ['src', 'statusline']) cpSync(join(ROOT, dir), join(RUNTIME, dir), { recursive: true })
  copyFileSync(join(ROOT, 'package.json'), join(RUNTIME, 'package.json'))
  say(true, t().deployed(RUNTIME))
}

function readSettings(): Record<string, unknown> {
  if (!existsSync(SETTINGS)) return {}
  const s: unknown = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  if (!isRec(s)) throw new Error(t().notJson(SETTINGS))
  return s
}

function writeSettings(s: Record<string, unknown>): void {
  writeAtomic(SETTINGS, JSON.stringify(s, null, 2) + '\n', 0o600)
}

function tapStatusline(): void {
  const s = readSettings()
  const sl = s['statusLine']
  const current = isRec(sl) ? str(sl, 'command') : null
  if (current === TAP_CMD) return say(true, t().tapActive)
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.bak-cctop`)
  // Re-pointing an existing tap keeps the saved original command as it is.
  if (!isTap(current)) writeAtomic(STATUSLINE_NEXT, current ?? '', 0o600)
  s['statusLine'] = { ...(isRec(sl) ? sl : {}), type: 'command', command: TAP_CMD }
  writeSettings(s)
  say(true, isTap(current) ? t().tapRepointed : t().tapInstalled(current))
}

function untapStatusline(): void {
  const s = readSettings()
  const sl = s['statusLine']
  if (!isRec(sl) || !isTap(str(sl, 'command'))) return say(false, t().tapMissing)
  const prev = readText(STATUSLINE_NEXT)?.trim()
  if (prev) s['statusLine'] = { ...sl, command: prev }
  else delete s['statusLine']
  writeSettings(s)
  say(true, prev ? t().tapRestored(prev) : t().tapRemoved)
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist(): string {
  const args = [process.execPath, '--disable-warning=ExperimentalWarning', join(RUNTIME, 'src', 'main.ts'), 'daemon']
  // launchd starts agents with a bare environment; a custom config dir has to be passed on.
  const dir = process.env['CLAUDE_CONFIG_DIR']
  const env = dir
    ? `\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>CLAUDE_CONFIG_DIR</key><string>${xml(dir)}</string>\n  </dict>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(DAEMON_LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(DAEMON_LOG)}</string>${env}
</dict>
</plist>
`
}

const domain = (): string => `gui/${process.getuid?.() ?? 501}`
const plistFor = (label: string): string => join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)

function launchctl(args: string[]): boolean {
  try {
    execFileSync('/bin/launchctl', args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function removeLegacy(): void {
  for (const label of LEGACY_LABELS) {
    const p = plistFor(label)
    if (!existsSync(p)) continue
    launchctl(['bootout', `${domain()}/${label}`])
    rmSync(p, { force: true })
    say(true, t().legacyRemoved(label))
  }
}

function startDaemon(): void {
  writeAtomic(PLIST, plist())
  launchctl(['bootout', `${domain()}/${LABEL}`])
  const ok = launchctl(['bootstrap', domain(), PLIST])
  say(ok, ok ? t().daemonRunning(LABEL) : t().daemonFailed(PLIST))
}

function stopDaemon(): void {
  // The launchd domain is per user, not per HOME: without our own plist the running agent belongs
  // to another install (for example a test HOME) and must be left alone.
  if (!existsSync(PLIST)) return say(false, t().daemonNotRunning)
  const ok = launchctl(['bootout', `${domain()}/${LABEL}`])
  rmSync(PLIST, { force: true })
  say(ok, ok ? t().daemonStopped : t().daemonNotRunning)
}

export function install(opts: { daemon: boolean }): void {
  mkdirSync(SL, { recursive: true })
  recordEnvironment()
  console.log(t().installTitle)
  checks()
  linkBin()
  deploy()
  tapStatusline()
  if (!MAC) say(false, t().daemonMacOnly)
  else {
    removeLegacy()
    if (opts.daemon) startDaemon()
    else {
      if (existsSync(PLIST)) stopDaemon()
      say(false, t().daemonSkipped)
    }
  }
  console.log(t().installDone(HOME))
}

export function uninstall(): void {
  console.log(t().uninstallTitle)
  if (MAC) {
    removeLegacy()
    stopDaemon()
  }
  untapStatusline()
  try {
    if (lstatSync(BIN_LINK).isSymbolicLink()) {
      rmSync(BIN_LINK)
      say(true, t().symlinkRemoved(BIN_LINK))
    }
  } catch {
    say(false, t().noSymlink)
  }
  rmSync(RUNTIME, { recursive: true, force: true })
  say(true, t().runtimeRemoved(RUNTIME))
  console.log(t().dataKept(HOME))
}
