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
export PPRO_SNAPSHOT_DIR="${PREMIERE_ASSISTANT_DATA:-$task_root/.local}/evaluation/snapshots"
proxy_pid=''
mcp_pid=''
cleanup() {
  if [ -n "$mcp_pid" ]; then kill "$mcp_pid" 2>/dev/null || true; fi
  if [ -n "$proxy_pid" ]; then kill "$proxy_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
if "$task_node" -e 'const net=require("node:net");const s=net.createConnection({host:"127.0.0.1",port:Number(process.env.PPRO_PROXY_PORT)});s.setTimeout(1000);s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1));'; then
  exec "$task_node" "$runtime/mcp/server.js"
else
  "$task_node" "$runtime/proxy/server.js" >&2 &
  proxy_pid=$!
  "$task_node" -e 'const net=require("node:net");let attempts=0;function probe(){const s=net.createConnection({host:"127.0.0.1",port:Number(process.env.PPRO_PROXY_PORT)});s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>{if(++attempts>=25)process.exit(1);setTimeout(probe,200)});}probe();'
fi
"$task_node" "$runtime/mcp/server.js" <&0 &
mcp_pid=$!
wait "$mcp_pid"
