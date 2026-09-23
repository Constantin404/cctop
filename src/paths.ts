import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const CLAUDE = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude')

// Claude Code's own state (read-only for us).
export const SESSIONS = join(CLAUDE, 'sessions')
export const JOBS = join(CLAUDE, 'jobs')
export const PROJECTS = join(CLAUDE, 'projects')
export const SETTINGS = join(CLAUDE, 'settings.json')

// cctop's state.
export const HOME = join(CLAUDE, 'cctop')
export const SL = join(HOME, 'sl')
export const EVENTS = join(HOME, 'events.jsonl')
export const USAGE_LOG = join(HOME, 'usage.jsonl')
export const CONFIG = join(HOME, 'config.json')
export const STATUSLINE_NEXT = join(HOME, 'statusline-next')
export const DAEMON_PID = join(HOME, 'daemon.pid')
export const DAEMON_LOG = join(HOME, 'daemon.log')

export const LABEL = 'cctop.notifier'
/** Label of the first local install; install and uninstall clean it up. */
export const LEGACY_LABELS = ['com.constantin.cctop'] as const
export const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
export const BIN_LINK = join(homedir(), '.local', 'bin', 'cctop')
// launchd processes may not read ~/Desktop (TCC), so the daemon and the status line tap run
// from a copy that `cctop install` deploys here.
export const RUNTIME = join(homedir(), '.local', 'share', 'cctop')
export const TAP = join(RUNTIME, 'statusline', 'tap.sh')
