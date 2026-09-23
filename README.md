# cctop

btop für Claude Code: eine Terminal-Ansicht, was gerade läuft, wie viel vom Limit noch da ist,
und eine Mitteilung, sobald eine Session fertig ist oder auf dich wartet.

```
cctop                  live-ansicht (q beendet)
cctop status [--json]  einmaliger schnappschuss, --json für skripte
cctop test-notify      test-mitteilung
```

## Was du siehst

- **usage**: 5-Stunden-Session-Limit und Wochen-Limit in %, Countdown bis zum Reset, Tempo in %/h
  und der erwartete Stand beim Reset (rot, wenn das Limit vorher voll läuft).
- **fleet**: wie viele Sessions arbeiten, auf dich warten, wie viele Subagents laufen; darunter
  der Verlauf der letzten Minuten als Braille-Graph.
- **sessions**: jede Live-Session mit Zustand, Name, Ordner, Art (`bg` = Background-Job,
  `cli` = interaktiv), Zeit im aktuellen Zustand, Kontext-Füllstand, Tokens, laufende Subagents,
  darunter die aktuelle Tätigkeit bzw. das Ergebnis.
- **log**: die letzten Mitteilungen.

Tasten: `↑↓`/`jk` wählen · `⏎` Background-Job in neuem Terminal-Fenster öffnen (`claude attach`) ·
`n` Mitteilungen an/aus · `d` nur aktive · `t` Test-Mitteilung · `q` beenden

## Woher die Zahlen kommen

- Sessions: `~/.claude/sessions/*.json` und `~/.claude/jobs/*/state.json`, dieselbe Quelle wie
  `claude agents --json`. Subagents: `~/.claude/projects/*/<session>/subagents/`.
- Usage: Claude Code reicht die Limit-Prozente nur an die Statusline weiter. `statusline/tap.sh`
  hängt sich vor die bisherige Statusline, speichert die Werte unter `~/.claude/cctop/sl/` und
  hängt `5h 12% 7d 67%` an die Statusline an. Jede Session kennt nur den Stand ihrer letzten
  Antwort; cctop nimmt pro Fenster den höchsten Wert.

Das Modell selbst bekommt diese Werte nie zu sehen. Deshalb antwortet Claude „kann ich nicht
einsehen“, während der Client trotzdem bei 90 % warnt: die Warnung kommt vom Programm, nicht vom
Modell.

## Mitteilungen

Ein launchd-Daemon (`com.constantin.cctop`) meldet sich, wenn ein Background-Job fertig ist, auf
dich wartet oder fehlschlägt, und wenn eine interaktive Session nach mindestens 20 s Arbeit
fertig ist. Läuft kein Daemon, übernimmt ein offenes cctop-Fenster.

Mit `terminal-notifier` holt ein Klick auf die Mitteilung das Terminal nach vorn. macOS muss das
einmal erlauben: `cctop test-notify` im Terminal ausführen und die Anfrage bestätigen (oder
Systemeinstellungen → Mitteilungen → terminal-notifier). Bis dahin laufen die Mitteilungen über
`osascript`.

Einstellungen in `~/.claude/cctop/config.json`: `notify`, `minWorkSec`, `soundDone`,
`soundInput`, `hideDone`.

## Installieren, aktualisieren, entfernen

`cctop install` legt den Symlink `~/.local/bin/cctop` an, kopiert die Runtime nach
`~/.local/share/cctop` (launchd-Prozesse dürfen nicht in `~/Desktop` lesen), setzt den
Statusline-Tap und startet den Daemon. Nach Änderungen am Code erneut ausführen.

`cctop uninstall` macht alles rückgängig. Backup der Settings: `~/.claude/settings.json.bak-cctop`.

## Entwicklung

Node ≥ 23.6 führt die `.ts`-Dateien direkt aus, es gibt keinen Build. Typecheck:
`npm i && npm run typecheck`.
