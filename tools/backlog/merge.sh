#!/usr/bin/env bash
# merge.sh ID BRANCH WORKTREE_AGENT_DIR  -- squash-merge a builder branch into develop and mark done
set -e
cd "$(dirname "$0")/../.."
ID=$1; BR=$2; WT=$3
MSG=$(git log -1 --no-merges --format=%s "$BR")
if ! git merge --squash -q "$BR"; then
  CONF=$(git diff --name-only --diff-filter=U)
  if [ "$CONF" = "pnpm-lock.yaml" ]; then
    git checkout --ours pnpm-lock.yaml 2>/dev/null || git show HEAD:pnpm-lock.yaml > pnpm-lock.yaml
    pnpm install --no-frozen-lockfile >/dev/null
    git add pnpm-lock.yaml
  else
    echo "CONFLICT: $CONF"; exit 2
  fi
fi
python3 tools/backlog/orch.py set "$ID" done merged_at=$(date -u +%F) >/dev/null
git add -A
git commit -q -m "$MSG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01APZc5n1iXh5k8hJZoGQif5"
[ -n "$WT" ] && git worktree remove --force ".claude/worktrees/$WT" 2>/dev/null || true
[ -n "$WT" ] && git branch -D "worktree-$WT" -q 2>/dev/null || true
git push -q
echo "merged $ID"
