#!/usr/bin/env bash
# A game whose look changed regenerates its how-to shots — the landing-time check.
#
# PR #79 (2026-09-05) resized eight boards and landed with every shot of them
# stale. The guide is data the player reads, so a stale shot is a wrong
# instruction, and nothing in the gate could see it: the shots are JPEGs and the
# suites do not read them. This reads the branch's diff against origin/main —
# a change under src/games/<id>/ (or src/games/<id>*.ts for the flat games) that
# is more than how-to copy or a test wants a change to assets/guide/<id>-*.jpg in
# the same range. Only games that HAVE shots are checked, so a module with no
# guide never trips it. With no origin/main to compare against (CI's shallow
# checkout) there is nothing to read: it says so and passes — this is a local
# landing check, wired into `npm run gate`.
#
#   bash tools/stale-shots.sh            # exit 1 and the game named, or 0
#
# Escape hatch, audited: a commit in the range carrying the trailer
#   Shots-Unchanged: <id> — <why>
# passes that game with a line saying so.
set -uo pipefail

if ! git rev-parse --verify -q refs/remotes/origin/main >/dev/null; then
  echo "stale-shots: no origin/main to compare against — nothing checked (CI's shallow checkout, or a repo with no remote)"
  exit 0
fi

base=$(git merge-base origin/main HEAD)
changed=$(git diff --name-only "$base" HEAD)

# The game ids whose rendering may have changed: a source file under the game,
# minus the how-to copy, the outcome copy and the tests.
ids=$(printf '%s\n' "$changed" \
  | grep -E '^src/games/' \
  | grep -vE '(-howto|-outcome|\.test|\.spec)\.ts$' \
  | sed -E 's#^src/games/(solitaire|trio-tumble)[^/]*$#\1#; s#^src/games/([^/.]+)/.*$#\1#; s#^src/games/([^/.]+)\.ts$#\1#' \
  | grep -vE '/' \
  | sort -u)

# A commit in the range may say, where a reader can find it, that a game's look in a
# still shot did not change:  Shots-Unchanged: <id> — <why>   (a slide beat is a
# transient; a re-encoded JPEG of the same picture is byte-identical and the diff
# cannot tell). One id per trailer; the why is required reading, not parsed.
declared=$(git log --format=%B "$base..HEAD" | grep -E '^Shots-Unchanged: ' | sed -E 's/^Shots-Unchanged: ([a-z0-9-]+).*/\1/')

status=0
for id in $ids; do
  # Only a game with a guide can have stale shots.
  if ! git ls-tree --name-only HEAD "assets/guide/" | grep -q "^assets/guide/$id-"; then continue; fi
  if printf '%s\n' "$declared" | grep -qx "$id"; then
    echo "stale-shots: $id changed and a commit says Shots-Unchanged for it — audited, not checked"
    continue
  fi
  if ! printf '%s\n' "$changed" | grep -q "^assets/guide/$id-"; then
    echo "stale-shots: $id changed under src/games/$id but no assets/guide/$id-*.jpg changed with it."
    echo "             Regenerate:  E2E_PORT=<port> node tools/guide-shots.mjs $id   (a served dist/ on that port)"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "stale-shots: every changed game's how-to shots moved with it (base $(git rev-parse --short "$base"))"
fi
exit $status
