#!/bin/bash
set -euo pipefail
plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
plugin_config="${PREMIERE_ASSISTANT_CONFIG:-$HOME/Library/Application Support/Premiere Editor Assistant/executables}"
case "$plugin_config" in /*) ;; *) echo 'PREMIERE_ASSISTANT_CONFIG must be an absolute directory.' >&2; exit 1 ;; esac
plugin_node="${PREMIERE_ASSISTANT_NODE:-}"
if [ -z "$plugin_node" ] && [ -f "$plugin_config/node" ]; then
  IFS= read -r plugin_node < "$plugin_config/node" || true
fi
supported_node() {
  [ -x "$1" ] && "$1" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' >/dev/null 2>&1
}
if [ -n "$plugin_node" ]; then
  if ! supported_node "$plugin_node"; then echo "Configured Node.js cannot run Node 22+: $plugin_node. Correct PREMIERE_ASSISTANT_NODE or $plugin_config/node." >&2; exit 1; fi
else
  # Desktop launches may not inherit an interactive shell's version-manager PATH.
  for candidate in "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node \
    "$HOME/.volta/bin/node" "$HOME/.local/share/mise/shims/node" \
    "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
    "$HOME/Library/Application Support/fnm/node-versions"/*/installation/bin/node \
    "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node \
    /opt/homebrew/opt/node@*/bin/node /usr/local/opt/node@*/bin/node; do
    if supported_node "$candidate"; then plugin_node="$candidate"; break; fi
  done
fi
if [ -z "$plugin_node" ]; then
  echo 'Premiere Editor Assistant could not find Node.js 22+. Reuse an existing installation first; set PREMIERE_ASSISTANT_NODE to its absolute executable path for bootstrap, then run launch.sh configure --node /absolute/path/to/node. Otherwise install Node.js 22+ through your package manager and rerun setup.' >&2
  exit 1
fi
case "${1:-}" in
  setup|doctor|configure|run|smoke) script="$1"; shift; exec "$plugin_node" "$plugin_root/scripts/$script.mjs" "$@" ;;
  *) exec "$plugin_node" "$plugin_root/scripts/bridge.mjs" "$@" ;;
esac
