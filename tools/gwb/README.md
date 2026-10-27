# Boing on gwb: uploads, erasure and triage

gwb (Debian, user `pl`, linger on) holds all Boing data in `~/boing-data` (moved from the Mac
2026-10-24; never in git: videos of people) and runs the upload pipeline:

```
phone ──PUT /upload, POST /done──▶ Kapsi (server/kapsi/) ◀──ssh every minute── gwb poll.sh
phone ──POST /erase──────────────▶ Kapsi: deletes that phone's uploads, logs the request, mails the owner
gwb poll.sh  (cron, no AI)   erase requests → tools/erase.py; complete sessions → ~/boing-data/uploads/
                             (verbatim; oldest removed beyond 200 GB, sessions with a .keep file stay)
triage                       manual: the owner runs the boing-uploads skill when they want to. The
                             unattended tools/gwb/triage.sh (inbox → library) is no longer started.
```

- Repo: `~/boing` (branch `dev`), `npm ci` at the root for the TypeScript tools.
- Logs and state: `~/boing-data/state/` (`poll.log`, `triage.log`, `reports/<session>.txt`,
  `retry-after`). Erasures: `~/boing-data/erase-log.jsonl`.
- Packages (apt): `ffmpeg nodejs npm python3-opencv jq`. Claude Code: native installer
  (`~/.local/bin/claude`), logged in as the owner.

## Setup

```
git clone git@github.com:ljungqvist/boing.git ~/boing && cd ~/boing && git checkout dev && npm ci
mkdir -p ~/.config/systemd/user && cp tools/gwb/claude-rc.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now claude-rc
( crontab -l 2>/dev/null; echo '* * * * * $HOME/boing/tools/gwb/poll.sh' ) | crontab -
```

The skill lives in `~/.agents/skills/boing-uploads/` (copied from the owner's Mac).

## Checks

- `tail ~/boing-data/state/poll.log ~/boing-data/state/triage.log`
- Waiting for the usage limit: `date -d @$(cat ~/boing-data/state/retry-after)`; remove the file to retry now.
- Erase by hand: `python3 -I tools/erase.py <recording ID>`.
