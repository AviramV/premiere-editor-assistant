#!/bin/bash
set -euo pipefail
plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
plugin_node="${PREMIERE_ASSISTANT_NODE:-$(command -v node || true)}"
if [ -z "$plugin_node" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then plugin_node="$candidate"; break; fi
  done
fi
if [ -z "$plugin_node" ]; then echo 'Premiere Editor Assistant requires Node.js 22+. Run its setup skill.' >&2; exit 1; fi
case "${1:-}" in
  setup|doctor|run|smoke) script="$1"; shift; exec "$plugin_node" "$plugin_root/scripts/$script.mjs" "$@" ;;
  *) exec "$plugin_node" "$plugin_root/scripts/bridge.mjs" "$@" ;;
esac
