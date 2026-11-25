#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="${PREMIERE_ASSISTANT_RUNTIME:-$task_root/.local/integrations}/quadlzzz"
task_node="${PREMIERE_ASSISTANT_NODE:-$(command -v node || true)}"
if [ -z "$task_node" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then task_node="$candidate"; break; fi
  done
fi
if [ -z "$task_node" ]; then echo "Node.js 22+ is required" >&2; exit 1; fi
export PPRO_PROXY_HOST=127.0.0.1
export PPRO_PROXY_PORT="${PPRO_PROXY_PORT:-3001}"
export PPRO_COMMAND_TIMEOUT_MS="${PPRO_COMMAND_TIMEOUT_MS:-180000}"
export PPRO_SNAPSHOT_DIR="${PREMIERE_ASSISTANT_STATE:-${PREMIERE_ASSISTANT_DATA:-$task_root/.local}}/evaluation/snapshots"
exec "$task_node" "$task_root/tools/start-quadlzzz.mjs" "$runtime"
