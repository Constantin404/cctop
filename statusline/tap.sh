#!/bin/bash
# cctop status line tap.
# Claude Code hands the 5-hour and weekly usage percentages only to the status line command, so
# this sits in front of the real one: it caches what cctop needs per session, runs the previous
# status line command unchanged, and appends a compact usage badge.

DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/cctop"
input=$(cat)

parsed=$(printf '%s' "$input" | jq -r '
  ({ session_id, at: (now | floor), rate_limits,
     context: .context_window.used_percentage, model: .model.display_name } | tojson),
  (.session_id // ""),
  (.rate_limits.five_hour.used_percentage // "" | if . == "" then . else floor end),
  (.rate_limits.seven_day.used_percentage // "" | if . == "" then . else floor end)
' 2>/dev/null)

{ IFS= read -r cache; IFS= read -r sid; IFS= read -r five; IFS= read -r week; } <<< "$parsed"

if [[ "$sid" =~ ^[A-Za-z0-9-]{8,64}$ ]]; then
  mkdir -p "$DIR/sl"
  tmp="$DIR/sl/.$sid.$$"
  printf '%s\n' "$cache" > "$tmp" && mv -f "$tmp" "$DIR/sl/$sid.json"
fi

prev=""
if [ -f "$DIR/statusline-next" ]; then
  next=$(cat "$DIR/statusline-next")
  # Never chain to a cctop tap: that would recurse forever.
  case "$next" in *cctop*statusline/tap.sh*) next="" ;; esac
  [ -n "$next" ] && prev=$(printf '%s' "$input" | bash -c "$next" 2>/dev/null)
fi

badge() {
  local c=108
  (( $2 >= 70 )) && c=179
  (( $2 >= 90 )) && c=167
  printf '\033[38;5;244m%s \033[38;5;%sm%s%%\033[0m' "$1" "$c" "$2"
}

b=""
[[ "$five" =~ ^[0-9]+$ ]] && b+="$(badge 5h "$five")"
[[ "$week" =~ ^[0-9]+$ ]] && b+="${b:+ }$(badge 7d "$week")"

printf '%s' "$prev"
[ -n "$prev" ] && [ -n "$b" ] && printf ' '
printf '%s' "$b"
