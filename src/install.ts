// `cctop install` wires three things, all reversible with `cctop uninstall`:
//   1. ~/.local/bin/cctop symlink
//   2. the status line tap in front of the existing status line command (the only place Claude
//      Code exposes the 5-hour / weekly usage percentages)
//   3. a launchd agent running the notifier, so finish notifications work with no cctop open

import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isRec, str } from './collect.ts'
import { BIN_LINK, DAEMON_LOG, HOME, LABEL, PLIST, ROOT, RUNTIME, SETTINGS, SL, STATUSLINE_NEXT, TAP } from './paths.ts'
import { readText, writeAtomic } from './store.ts'

const TAP_CMD = `bash "${TAP}"`

/** Any cctop tap, including one from an older install location, so it is never chained to itself. */
const isTap = (cmd: string | null): boolean => cmd !== null && cmd.includes('cctop') && cmd.includes('statusline/tap.sh')

function say(ok: boolean, msg: string): void {
  console.log(`${ok ? '  ✓' : '  ·'} ${msg}`)
}

function linkBin(): void {
  const target = join(ROOT, 'bin', 'cctop')
  try {
    const st = lstatSync(BIN_LINK)
    if (!st.isSymbolicLink()) return say(false, `${BIN_LINK} existiert und ist kein symlink, übersprungen`)
    if (readlinkSync(BIN_LINK) === target) return say(true, `cctop liegt schon in ${dirname(BIN_LINK)}`)
    rmSync(BIN_LINK)
  } catch {
    // Not there yet.
  }
  mkdirSync(dirname(BIN_LINK), { recursive: true })
  symlinkSync(target, BIN_LINK)
  say(true, `symlink ${BIN_LINK} → ${target}`)
}

function deploy(): void {
  if (ROOT === RUNTIME) return say(false, 'läuft schon aus der runtime-kopie, deploy übersprungen')
  rmSync(RUNTIME, { recursive: true, force: true })
  mkdirSync(RUNTIME, { recursive: true })
  for (const dir of ['src', 'statusline']) cpSync(join(ROOT, dir), join(RUNTIME, dir), { recursive: true })
  copyFileSync(join(ROOT, 'package.json'), join(RUNTIME, 'package.json'))
  say(true, `runtime-kopie nach ${RUNTIME}`)
}

function readSettings(): Record<string, unknown> {
  const raw = readFileSync(SETTINGS, 'utf8')
  const s: unknown = JSON.parse(raw)
  if (!isRec(s)) throw new Error(`${SETTINGS} ist kein JSON-objekt`)
  return s
}

function writeSettings(s: Record<string, unknown>): void {
  writeAtomic(SETTINGS, JSON.stringify(s, null, 2) + '\n', 0o600)
}

function tapStatusline(): void {
  const s = readSettings()
  const sl = s['statusLine']
  const current = isRec(sl) ? str(sl, 'command') : null
  if (current === TAP_CMD) return say(true, 'statusline-tap ist schon aktiv')
  copyFileSync(SETTINGS, `${SETTINGS}.bak-cctop`)
  // Re-pointing an existing tap keeps the saved original command as it is.
  if (!isTap(current)) writeAtomic(STATUSLINE_NEXT, current ?? '', 0o600)
  s['statusLine'] = { ...(isRec(sl) ? sl : {}), type: 'command', command: TAP_CMD }
  writeSettings(s)
  say(true, isTap(current) ? 'statusline-tap auf runtime-kopie umgestellt' : `statusline-tap vor ${current ? `"${current}"` : '(keine statusline)'} gehängt, backup: settings.json.bak-cctop`)
}

function untapStatusline(): void {
  const s = readSettings()
  const sl = s['statusLine']
  if (!isRec(sl) || !isTap(str(sl, 'command'))) return say(false, 'statusline-tap nicht aktiv')
  const prev = readText(STATUSLINE_NEXT)?.trim()
  if (prev) s['statusLine'] = { ...sl, command: prev }
  else delete s['statusLine']
  writeSettings(s)
  say(true, prev ? `statusline zurück auf "${prev}"` : 'statusline entfernt')
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist(): string {
  const args = [process.execPath, '--disable-warning=ExperimentalWarning', join(RUNTIME, 'src', 'main.ts'), 'daemon']
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
  <key>StandardErrorPath</key><string>${xml(DAEMON_LOG)}</string>
</dict>
</plist>
`
}

const domain = (): string => `gui/${process.getuid?.() ?? 501}`

function launchctl(args: string[]): boolean {
  try {
    execFileSync('/bin/launchctl', args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function startDaemon(): void {
  writeAtomic(PLIST, plist())
  launchctl(['bootout', `${domain()}/${LABEL}`])
  const ok = launchctl(['bootstrap', domain(), PLIST])
  say(ok, ok ? `notifier-daemon läuft (launchd ${LABEL})` : `launchctl bootstrap fehlgeschlagen, plist liegt in ${PLIST}`)
}

function stopDaemon(): void {
  const ok = launchctl(['bootout', `${domain()}/${LABEL}`])
  rmSync(PLIST, { force: true })
  say(ok, ok ? 'notifier-daemon gestoppt' : 'notifier-daemon lief nicht')
}

export function install(): void {
  mkdirSync(SL, { recursive: true })
  console.log('cctop install')
  linkBin()
  deploy()
  tapStatusline()
  startDaemon()
  console.log(`\nfertig. start: cctop   ·   daten: ${HOME}`)
}

export function uninstall(): void {
  console.log('cctop uninstall')
  stopDaemon()
  untapStatusline()
  try {
    if (lstatSync(BIN_LINK).isSymbolicLink()) {
      rmSync(BIN_LINK)
      say(true, `symlink ${BIN_LINK} entfernt`)
    }
  } catch {
    say(false, 'kein symlink')
  }
  rmSync(RUNTIME, { recursive: true, force: true })
  say(true, `runtime-kopie ${RUNTIME} entfernt`)
  console.log(`\ndaten bleiben in ${HOME} (löschen: rm -r "${HOME}")`)
}
