#!/bin/sh
# The upload server on Kapsi (server/kapsi/, https://ljungqvist.info/boing/).
# Fetching and triaging uploads: the boing-uploads agent skill (one file at a time, not here).
#   tools/kapsi.sh deploy   copy server/kapsi/ to the web root; create the upload key if missing
#   tools/kapsi.sh rotate   make a new upload key (old APKs can't upload until rebuilt; run key after)
#   tools/kapsi.sh key      set the GitHub secret BOING_UPLOAD_KEY from the server's key (needs gh)
set -eu
HOST=pl@kapsi.fi
WEB=sites/ljungqvist.info/www/boing
DATA=sites/ljungqvist.info/boing-data
REPO=$(cd "$(dirname "$0")/.." && pwd)

case "${1:-}" in
  deploy)
    ssh "$HOST" "mkdir -p $WEB $DATA/uploads && chmod 700 $DATA &&
      { [ -s $DATA/upload-key ] || (umask 077; openssl rand -hex 24 > $DATA/upload-key); }"
    rsync -av "$REPO/server/kapsi/" "$HOST:$WEB/"
    ;;
  rotate)
    ssh "$HOST" "umask 077; openssl rand -hex 24 > $DATA/upload-key"
    ;;
  key)
    ssh "$HOST" cat $DATA/upload-key | gh secret set BOING_UPLOAD_KEY --repo ljungqvist/boing
    ;;
  *)
    echo "usage: $0 deploy|rotate|key" >&2; exit 2 ;;
esac
