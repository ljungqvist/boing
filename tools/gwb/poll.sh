#!/bin/sh
# gwb, cron every minute, no AI (works when the Claude usage limit is reached):
#   1. erase requests on Kapsi (consent withdrawn) → tools/erase.py for each recording ID
#   2. complete sessions on Kapsi (uploads/<session>/.done) → ~/boing-data/inbox/<session>/, file by
#      file with a size check, then deleted on Kapsi
#   3. sessions in the inbox → tools/gwb/triage.sh in the background (the agent)
# Log: ~/boing-data/state/poll.log. Setup: tools/gwb/README.md.
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
DATA=${BOING_DATA:-$HOME/boing-data}
KAPSI=${BOING_KAPSI:-pl@kapsi.fi}
K=sites/ljungqvist.info/boing-data
STATE=$DATA/state
mkdir -p "$STATE" "$DATA/inbox"
exec 9>"$STATE/poll.lock"
flock -n 9 || exit 0
log() { echo "$(date -Is) $*" >>"$STATE/poll.log"; }
k() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$KAPSI" "$@"; }

# 1. Erase requests. Taken over by renaming, so requests arriving meanwhile wait for the next run;
#    a run that fails leaves erase-processing-* for the next one.
reqs=$(k "cd $K && { [ ! -s erase-requests.jsonl ] || mv erase-requests.jsonl erase-processing-\$(date +%s).jsonl; }
  cat erase-processing-*.jsonl 2>/dev/null || true")
if [ -n "$reqs" ]; then
  for phone in $(printf '%s\n' "$reqs" | jq -r '.phone // empty' | sort -u); do
    python3 -I "$REPO/tools/erase.py" --data "$DATA" "$phone" >>"$STATE/poll.log" 2>&1
    log "erased $phone"
  done
  k "cd $K && cat erase-processing-*.jsonl >>erase-done.jsonl && rm -f erase-processing-*.jsonl"
fi
# Recording IDs erased before: never fetched again; anything with them left over (a triage run that
# was busy with it) goes again. The app makes a new ID after withdrawing, so this never hits new data.
erased=$(jq -r '.phone' "$DATA/erase-log.jsonl" 2>/dev/null | sort -u)
for phone in $erased; do
  if ls -d "$DATA"/inbox/*_"$phone" "$DATA"/uploads/*_"$phone" >/dev/null 2>&1; then
    python3 -I "$REPO/tools/erase.py" --data "$DATA" "$phone" >>"$STATE/poll.log" 2>&1
    log "erased leftovers of $phone"
  fi
done

# 2. Complete sessions.
for s in $(k "cd $K/uploads 2>/dev/null && for d in */.done; do [ -e \"\$d\" ] && echo \"\${d%/.done}\"; done; true"); do
  case $s in */* | .* | '') continue ;; esac
  phone=${s##*_}
  if printf '%s\n' "$erased" | grep -qx "$phone"; then
    k "rm -rf $K/uploads/$s"
    log "dropped $s (erased recording ID)"
    continue
  fi
  part=$DATA/inbox/.$s.part
  mkdir -p "$part"
  ok=1
  k "cd $K/uploads/$s && stat -c '%s %n' -- *" | while read -r size name; do
    case $name in */* | .*) continue ;; esac
    scp -q -o BatchMode=yes "$KAPSI:$K/uploads/$s/$name" "$part/$name" </dev/null
    [ "$(stat -c %s "$part/$name")" = "$size" ] || { log "size mismatch $s/$name"; exit 1; }
  done || ok=0
  if [ $ok = 1 ] && [ -f "$part/session.json" ]; then
    rm -rf "$DATA/inbox/$s"
    mv "$part" "$DATA/inbox/$s"
    k "rm -rf $K/uploads/$s"
    log "fetched $s ($(ls "$DATA/inbox/$s" | wc -l) files)"
  else
    log "fetch of $s failed; retrying next run"
  fi
done

# 3. Triage (own lock; exits at once when it's running or waiting for the usage limit).
if ls -d "$DATA"/inbox/[0-9]* >/dev/null 2>&1; then
  nohup "$REPO/tools/gwb/triage.sh" >>"$STATE/triage.log" 2>&1 &
fi
