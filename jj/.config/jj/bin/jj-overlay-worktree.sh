#!/usr/bin/env bash
# Overlay a real git worktree onto an existing jj workspace directory.
# Result: the directory is BOTH a jj workspace (of the single shared jj repo)
# and a linked git worktree (of the shared git repo), so git-based tooling
# such as `pre-commit` works there.
#
# Usage: jj-overlay-worktree.sh <main-repo-path> <jj-workspace-path>
set -euo pipefail

MAIN="$(cd "$1" && pwd)"
WS="$(cd "$2" && pwd)"
NAME="$(basename "$WS")"
STAGING="$(dirname "$WS")/.gitwt-staging"
TMP="$STAGING/$NAME"

if [ -e "$WS/.git" ]; then
  echo "skip: $WS already has .git"
  exit 0
fi

# 1. Create the worktree admin dir. --no-checkout is critical: git must never
#    write into the directory, because jj already owns its contents.
rm -rf "$STAGING"
git -C "$MAIN" worktree add --no-checkout --detach "$TMP" >/dev/null
mv "$TMP/.git" "$WS/.git"
rm -rf "$STAGING"

# 2. Repoint the admin dir at the real location.
git -C "$MAIN" worktree repair "$WS" >/dev/null 2>&1 || true

# 3. Point git HEAD at the jj working-copy commit's parent (@-) and sync the
#    index to it, without touching the working tree. This mirrors how jj
#    behaves in a colocated repo: `git status` then shows exactly the jj
#    working-copy changes.
PARENT="$(jj -R "$WS" --ignore-working-copy log --no-graph -r '@-' -T 'commit_id')"
git -C "$WS" update-ref --no-deref HEAD "$PARENT"
git -C "$WS" reset -q

# 4. Hide .jj/ from git, the same way jj does in a colocated repo.
printf '/*\n' > "$WS/.jj/.gitignore"

echo "ok: $WS -> git worktree at $PARENT"
