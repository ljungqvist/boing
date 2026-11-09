#!/usr/bin/env bash
# Run --check before building, and without it only after saving the signed AAB.
set -euo pipefail

check_only=false
if [[ ${1:-} == --check ]]; then
  check_only=true
  shift
fi
if [[ $# != 3 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! $2 =~ ^[1-9][0-9]{0,9}$ ]]; then
  echo "Usage: $0 [--check] <major.minor.patch> <version-code> <commit>" >&2
  exit 1
fi
tag="v$1"
version_code=$2
commit=$(git rev-parse --verify "$3^{commit}")
ref="refs/tags/$tag"

# Check the remote, since Actions checkouts need not contain any local tags.
existing=$(git ls-remote --tags origin "$ref")
if [[ -n $existing ]]; then
  git fetch --no-tags origin "$ref"
  tagged_commit=$(git rev-parse 'FETCH_HEAD^{commit}')
  if [[ $tagged_commit != "$commit" ]]; then
    echo "::error::$tag already points to $tagged_commit. Bump the app version before building different source." >&2
    exit 1
  fi
  echo "$tag already identifies this commit; leaving it unchanged."
  exit 0
fi

if $check_only; then
  echo "$tag is available; it will be created after the signed AAB is saved."
  exit 0
fi

message="Boing $1 — signed Play bundle, version code $version_code"
if [[ -n ${GITHUB_RUN_ID:-} ]]; then
  message+=$'\n\n'"Build: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
fi
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  tag -a --no-sign "$tag" "$commit" -m "$message"
# No force: a concurrent run cannot overwrite a published version tag either.
git push origin "$ref"
echo "Created $tag on $commit."
