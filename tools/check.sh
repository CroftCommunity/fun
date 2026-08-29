#!/usr/bin/env bash
# Run a verification command so its RESULT actually reaches you.
#
# The problem this solves is not exotic. Every one of these was written by
# someone who believed they were checking something:
#
#   npm run test:rust | tail -40          exit status is TAIL's, and the log is
#                                         the tail — the header, the failures and
#                                         the counts are all above the fold
#   cargo clippy | grep -c error && git commit
#                                         grep succeeds whether or not it finds
#                                         anything, so the commit always runs
#   cargo mutants | tail -12              a truncated log read as a complete one:
#                                         11 survivors looked like all of them
#
# A pipeline reports the exit status of its LAST command, so piping a check into
# anything discards the thing you were checking. And a check whose output is
# truncated can report green while the evidence for red sits above the cut.
#
# Usage:  bash tools/check.sh <label> <command...>
#
# Writes the whole output to a log, prints the tail for reading, and exits with
# the command's own status — so `&&`, `if`, and CI all see the truth.
set -uo pipefail

label="${1:?usage: check.sh <label> <command...>}"
shift
log="${CHECK_LOG_DIR:-/tmp}/check-${label}.log"

"$@" > "$log" 2>&1
status=$?

lines=$(wc -l < "$log" | tr -d ' ')
if [ "$status" -eq 0 ]; then
  printf '\n=== %s: PASS (exit 0, %s lines -> %s)\n' "$label" "$lines" "$log"
  tail -5 "$log"
else
  printf '\n=== %s: FAIL (exit %s, %s lines -> %s)\n' "$label" "$status" "$lines" "$log"
  # On failure show more, and say plainly that this is not the whole log —
  # the habit this script exists to break is treating a tail as the result.
  tail -40 "$log"
  printf '\n--- the above is the TAIL of %s lines. Read %s in full before concluding anything.\n' "$lines" "$log"
fi
exit "$status"
