#!/bin/sh
# Tests server/kapsi/index.php with PHP's built-in server and a temporary data folder.
# Run where php is installed (Kapsi's shell: scp the folder there, or tools/kapsi.sh test).
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
DATA=$(mktemp -d)
PORT=8799
trap 'kill $PID 2>/dev/null; rm -rf "$DATA"' EXIT
mkdir -p "$DATA/uploads"
echo testkey > "$DATA/upload-key"
BOING_DATA=$DATA php -S 127.0.0.1:$PORT -t "$DIR" "$DIR/index.php" >/dev/null 2>&1 &
PID=$!
sleep 1
U=http://127.0.0.1:$PORT/boing
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got $2, want $3"; fail=1; fi; }
P=0123456789ab
Q=ba9876543210

check "page" "$(code $U/)" 200
check "upload without key" "$(code -X PUT --data-binary x "$U/upload?session=s1_$P&name=a.mp4")" 403
check "upload" "$(code -X PUT -H 'X-Boing-Key: testkey' --data-binary x "$U/upload?session=s1_$P&name=a.mp4")" 200
check "upload other phone" "$(code -X PUT -H 'X-Boing-Key: testkey' --data-binary y "$U/upload?session=s1_$Q&name=a.mp4")" 200
check "done without key" "$(code -X POST "$U/done?session=s1_$P")" 403
check "done unknown session" "$(code -X POST -H 'X-Boing-Key: testkey' "$U/done?session=nope")" 404
check "done" "$(code -X POST -H 'X-Boing-Key: testkey' "$U/done?session=s1_$P")" 200
check "done marker" "$(test -f "$DATA/uploads/s1_$P/.done" && echo yes)" yes
check "erase bad phone" "$(code -X POST -H 'X-Boing-Key: testkey' "$U/erase?phone=abc")" 400
check "erase" "$(code -X POST -H 'X-Boing-Key: testkey' "$U/erase?phone=$P")" 200
check "erased folder" "$(test -d "$DATA/uploads/s1_$P" && echo still || echo gone)" gone
check "other phone kept" "$(test -f "$DATA/uploads/s1_$Q/a.mp4" && echo yes)" yes
check "request logged" "$(grep -c "\"phone\":\"$P\"" "$DATA/erase-requests.jsonl")" 1
exit $fail
