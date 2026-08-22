#!/usr/bin/env bash
# Executes a workflow job's `run:` steps on this machine.
#
# Not a GitHub Actions emulator — `uses:` steps (checkout, caches, artifact
# upload) are reported and skipped, as are package installs and the long native
# builds. What it does run is every line of project-specific shell in the
# pipeline, which is where the bugs live.
#
# Usage: run-workflow-locally.sh <workflow.yml> <job> [VAR=VALUE ...]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$ROOT/.github/scripts/run_workflow_locally.py" "$@"
