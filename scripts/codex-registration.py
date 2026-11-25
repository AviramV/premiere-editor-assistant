"""Retire the two uncustomized Codex registrations created by the old discovery workaround."""
import copy
import json
import os
from pathlib import Path
import re
import sys
import tempfile

NAME = "premiere-editor-assistant"
HEADER = ("# Premiere Editor Assistant: use the installed bridges as configured MCP servers\n"
          "# so Codex exposes the full catalogue. See docs/TOOL_DISCOVERY.md.")
BACKENDS = ("premiere_cep", "premiere_uxp")


def migrate(plugin, home):
    if plugin.parent == home / ".tmp" / "marketplaces":
        market = plugin.name
    elif plugin.parent.name == NAME and plugin.parent.parent.parent == home / "plugins" / "cache":
        market = plugin.parent.parent.name
    else:
        return {"status": "outside_codex_installation"}

    config = home / "config.toml"
    if config.is_symlink() or not config.is_file():
        return {"status": "no_managed_config"}
    raw = config.read_bytes()
    text = raw.decode()
    if not any("[mcp_servers." + key + "]" in text for key in BACKENDS):
        return {"status": "bundled"}
    manual = {"status": "manual_review", "action": "Review explicit Premiere MCP entries and preserve any intentional tool restrictions."}
    if text.count(HEADER) != 1:
        return manual
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            try:
                from pip._vendor import tomli as tomllib
            except ImportError:
                return manual
    before = tomllib.loads(text)
    if before.get("plugins", {}).get(NAME + "@" + market, {}).get("enabled") is not True:
        return manual
    prefix = home / "plugins/cache" / market / NAME
    sections = []
    for key in BACKENDS:
        server = before.get("mcp_servers", {}).get(key, {})
        args = server.get("args", [])
        if not isinstance(args, list) or len(args) != 2 or not isinstance(args[0], str):
            return manual
        launch = Path(args[0])
        if (launch.parent.parent.parent != prefix or launch.parts[-2:] != ("scripts", "launch.sh") or
                not re.fullmatch(r"\d+\.\d+\.\d+", launch.parent.parent.name) or
                server != {"command": "bash", "args": [args[0], key]}):
            return manual
        sections.append('[mcp_servers.' + key + ']\ncommand = "bash"\nargs = [' +
                        json.dumps(args[0], ensure_ascii=False) + ', "' + key + '"]')
    block = HEADER + "\n\n" + "\n\n".join(sections) + "\n"
    if text.count(block) != 1:
        return manual
    after = text.replace(block, "", 1)
    expected = copy.deepcopy(before)
    for key in BACKENDS:
        del expected["mcp_servers"][key]
    if not expected["mcp_servers"]:
        del expected["mcp_servers"]
    if tomllib.loads(after) != expected:
        return manual
    with tempfile.NamedTemporaryFile(dir=home, prefix="config.toml.before-premiere-upgrade-", delete=False) as backup:
        backup.write(raw)
    with tempfile.NamedTemporaryFile(dir=home, prefix=".premiere-config-", delete=False) as output:
        temporary = Path(output.name)
        output.write(after.encode())
    try:
        if config.is_symlink() or config.read_bytes() != raw:
            return manual
        os.chmod(temporary, config.stat().st_mode & 0o777)
        os.replace(temporary, config)
    finally:
        temporary.unlink(missing_ok=True)
    return {"status": "bundled_on_next_reload", "backup": backup.name}


if __name__ == "__main__":
    print(json.dumps(migrate(Path(sys.argv[1]), Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")))))
