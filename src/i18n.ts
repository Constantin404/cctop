// UI strings in English and German. The language follows the system locale unless config.json
// sets `lang`; `cctop install` writes the detected one there so the launchd daemon, which runs
// without a locale, speaks the same language as the terminal.

export type Lang = 'en' | 'de'

const en = {
  // usage box
  session: 'session',
  week: 'week',
  resetNew: '↻ new',
  noData: ' no data yet: arrives with the next reply of any session',
  needTap: ' (needs the status line tap: cctop install)',
  windowReset: ' 5h window reset, new values with the next reply',
  collecting: ' rate: collecting samples …',
  rate: (r: string) => ` rate ${r}%/h`,
  fullIn: (d: string) => ` → full in ~${d}, before the reset`,
  atReset: (p: number) => ` → ~${p}% at reset`,
  updated: (d: string, stale: boolean) => ` updated ${d} ago${stale ? ' (stale: no active session)' : ''} · via status line`,
  // fleet box
  notifyHere: ' here',
  notifyOff: '○ off',
  // sessions box
  bgTasks: (n: number) => ` · ${n} background task${n > 1 ? 's' : ''}`,
  nothingActive: ' nothing active (d shows all)',
  noSessions: ' no running Claude sessions',
  keySelect: 'select',
  keyAll: 'all',
  keyActive: 'active only',
  // log box
  noEvents: ' no notifications yet: they appear when a session finishes or waits for you',
  tooSmall: (w: number, h: number) => ` cctop needs at least 60×16 (now ${w}×${h})`,
  // flashes
  interactive: 'interactive session: lives in its own terminal tab',
  attached: (id: string) => `attach ${id} → new terminal window`,
  copied: (id: string) => `copied: claude attach ${id}`,
  runCmd: (id: string) => `run: claude attach ${id}`,
  notifyOn: 'notifications on',
  notifyOffFlash: 'notifications off',
  testSent: 'test notification sent',
  testText: 'This is what a notification looks like when a session finishes.',
  // notifications
  done: 'done',
  input: 'waiting for you',
  failed: 'failed',
  test: 'test',
  needsDecision: 'needs a decision',
  replyReady: (dir: string, d: string) => `reply ready · ${dir} · ${d}`,
  // time
  now: 'now',
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as readonly string[],
  // cli
  help: `cctop: btop for Claude Code

  cctop                    live view (q quits)
  cctop status [--json]    one-off snapshot
  cctop install            status line tap, notifier daemon, symlink
  cctop install --no-daemon   same, without the notifier daemon
  cctop uninstall          removes all of it again
  cctop test-notify        sends a test notification
`,
  statusNoData: 'no data yet',
  statusFleet: (w: number, s: number, n: number, notify: string) => `fleet  ${w} working · ${s} subagents · ${n} sessions · notify ${notify}`,
  statusNoDaemon: 'off (no daemon)',
  // install
  installTitle: 'cctop install',
  uninstallTitle: 'cctop uninstall',
  needJq: 'jq not found: the status line tap needs it (brew install jq). Usage limits stay empty until then.',
  noNotifier: 'terminal-notifier not found: notifications fall back to osascript (brew install terminal-notifier for click-to-focus)',
  binExists: (p: string) => `${p} exists and is not a symlink, skipped`,
  binLinked: (p: string) => `cctop is already in ${p}`,
  binCreated: (p: string, target: string) => `symlink ${p} → ${target}`,
  notOnPath: (dir: string) => `${dir} is not on your PATH: add  export PATH="${dir}:$PATH"  to your shell profile`,
  deploySkipped: 'already running from the runtime copy, deploy skipped',
  deployed: (p: string) => `runtime copy in ${p}`,
  tapActive: 'status line tap already active',
  tapRepointed: 'status line tap moved to the runtime copy',
  tapInstalled: (prev: string | null) => `status line tap placed in front of ${prev ? `"${prev}"` : '(no status line)'}, backup: settings.json.bak-cctop`,
  tapMissing: 'status line tap not active',
  tapRestored: (prev: string) => `status line restored to "${prev}"`,
  tapRemoved: 'status line removed',
  daemonRunning: (label: string) => `notifier daemon running (launchd ${label})`,
  daemonFailed: (p: string) => `launchctl bootstrap failed, plist is at ${p}`,
  daemonSkipped: 'notifier daemon skipped (--no-daemon); an open cctop window still notifies',
  daemonMacOnly: 'notifier daemon needs macOS (launchd), skipped',
  daemonStopped: 'notifier daemon stopped',
  daemonNotRunning: 'notifier daemon was not running',
  legacyRemoved: (label: string) => `old launchd agent ${label} removed`,
  symlinkRemoved: (p: string) => `symlink ${p} removed`,
  noSymlink: 'no symlink',
  runtimeRemoved: (p: string) => `runtime copy ${p} removed`,
  installDone: (home: string) => `\ndone. start: cctop   ·   data: ${home}\nallow notifications once: cctop test-notify`,
  dataKept: (home: string) => `\ndata stays in ${home} (delete: rm -r "${home}")`,
  notJson: (p: string) => `${p} is not a JSON object`,
}

const de: typeof en = {
  session: 'session',
  week: 'woche',
  resetNew: '↻ neu',
  noData: ' noch keine werte: kommen mit der nächsten antwort einer session',
  needTap: ' (statusline-tap nötig: cctop install)',
  windowReset: ' 5h-fenster zurückgesetzt, neue werte mit der nächsten antwort',
  collecting: ' tempo: sammle messpunkte …',
  rate: (r) => ` tempo ${r}%/h`,
  fullIn: (d) => ` → voll in ~${d}, vor dem reset`,
  atReset: (p) => ` → ~${p}% beim reset`,
  updated: (d, stale) => ` stand vor ${d}${stale ? ' (alt: keine session aktiv)' : ''} · quelle statusline`,
  notifyHere: ' hier',
  notifyOff: '○ aus',
  bgTasks: (n) => ` · ${n} task${n > 1 ? 's' : ''} im hintergrund`,
  nothingActive: ' nichts aktiv (d zeigt alle)',
  noSessions: ' keine laufenden Claude-Sessions',
  keySelect: 'wählen',
  keyAll: 'alle',
  keyActive: 'nur aktive',
  noEvents: ' noch keine meldungen: erscheinen, sobald eine session fertig ist oder auf dich wartet',
  tooSmall: (w, h) => ` cctop braucht mindestens 60×16 (jetzt ${w}×${h})`,
  interactive: 'interaktive session: läuft in ihrem eigenen terminal-tab',
  attached: (id) => `attach ${id} → neues terminal-fenster`,
  copied: (id) => `kopiert: claude attach ${id}`,
  runCmd: (id) => `ausführen: claude attach ${id}`,
  notifyOn: 'notifications an',
  notifyOffFlash: 'notifications aus',
  testSent: 'test-meldung gesendet',
  testText: 'So sieht eine Meldung aus, wenn eine Session fertig ist.',
  done: 'fertig',
  input: 'wartet auf dich',
  failed: 'fehlgeschlagen',
  test: 'test',
  needsDecision: 'braucht eine Entscheidung',
  replyReady: (dir, d) => `Antwort bereit · ${dir} · ${d}`,
  now: 'jetzt',
  days: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  help: `cctop: btop für Claude Code

  cctop                    live-ansicht (q beendet)
  cctop status [--json]    einmaliger schnappschuss
  cctop install            statusline-tap, notifier-daemon, symlink
  cctop install --no-daemon   dasselbe, ohne notifier-daemon
  cctop uninstall          alles davon wieder raus
  cctop test-notify        test-meldung ins notification center
`,
  statusNoData: 'noch keine werte',
  statusFleet: (w, s, n, notify) => `fleet  ${w} arbeiten · ${s} subagents · ${n} sessions · notify ${notify}`,
  statusNoDaemon: 'aus (kein daemon)',
  installTitle: 'cctop install',
  uninstallTitle: 'cctop uninstall',
  needJq: 'jq fehlt: der statusline-tap braucht es (brew install jq). bis dahin bleiben die limits leer.',
  noNotifier: 'terminal-notifier fehlt: mitteilungen laufen über osascript (brew install terminal-notifier für klick → terminal)',
  binExists: (p) => `${p} existiert und ist kein symlink, übersprungen`,
  binLinked: (p) => `cctop liegt schon in ${p}`,
  binCreated: (p, target) => `symlink ${p} → ${target}`,
  notOnPath: (dir) => `${dir} ist nicht im PATH: export PATH="${dir}:$PATH" ins shell-profil eintragen`,
  deploySkipped: 'läuft schon aus der runtime-kopie, deploy übersprungen',
  deployed: (p) => `runtime-kopie nach ${p}`,
  tapActive: 'statusline-tap ist schon aktiv',
  tapRepointed: 'statusline-tap auf runtime-kopie umgestellt',
  tapInstalled: (prev) => `statusline-tap vor ${prev ? `"${prev}"` : '(keine statusline)'} gehängt, backup: settings.json.bak-cctop`,
  tapMissing: 'statusline-tap nicht aktiv',
  tapRestored: (prev) => `statusline zurück auf "${prev}"`,
  tapRemoved: 'statusline entfernt',
  daemonRunning: (label) => `notifier-daemon läuft (launchd ${label})`,
  daemonFailed: (p) => `launchctl bootstrap fehlgeschlagen, plist liegt in ${p}`,
  daemonSkipped: 'notifier-daemon übersprungen (--no-daemon); ein offenes cctop-fenster meldet trotzdem',
  daemonMacOnly: 'notifier-daemon braucht macOS (launchd), übersprungen',
  daemonStopped: 'notifier-daemon gestoppt',
  daemonNotRunning: 'notifier-daemon lief nicht',
  legacyRemoved: (label) => `alter launchd-agent ${label} entfernt`,
  symlinkRemoved: (p) => `symlink ${p} entfernt`,
  noSymlink: 'kein symlink',
  runtimeRemoved: (p) => `runtime-kopie ${p} entfernt`,
  installDone: (home) => `\nfertig. start: cctop   ·   daten: ${home}\nmitteilungen einmal erlauben: cctop test-notify`,
  dataKept: (home) => `\ndaten bleiben in ${home} (löschen: rm -r "${home}")`,
  notJson: (p) => `${p} ist kein JSON-objekt`,
}

export function detectLang(): Lang {
  const env = process.env['LC_ALL'] || process.env['LC_MESSAGES'] || process.env['LANG'] || ''
  const locale = env || Intl.DateTimeFormat().resolvedOptions().locale
  return /^de/i.test(locale) ? 'de' : 'en'
}

let lang: Lang = detectLang()

export function setLang(l: Lang): void {
  lang = l
}

export const t = (): typeof en => (lang === 'de' ? de : en)
