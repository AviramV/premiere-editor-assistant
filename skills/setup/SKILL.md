---
name: setup
description: Set up or diagnose Premiere Editor Assistant on a local Mac, including its Premiere bridges and optional transcription dependencies. Use for this plugin’s installation and connection problems.
---

Use this workflow for the Premiere Editor Assistant plugin. Resolve the plugin root from this file: two directories above its containing folder. Run commands using absolute paths and quote paths with spaces.

1. Run `/bin/bash "<plugin-root>/scripts/launch.sh" doctor`. This is a dependency check, not a live Premiere acceptance test. Release 0.1 supports macOS and English editorial input; Apple Silicon is required for optional local MLX transcription. The native workflow was exercised with Premiere 26.3.2; a new host version needs read-only capability checks first.
2. If setup was requested, run `/bin/bash "<plugin-root>/scripts/launch.sh" setup` to download and verify the pinned bridges, install locked JavaScript dependencies, apply the guarded reorder patch, and prepare a CCX installer. It reports its local data directory. The package contains no footage or project configuration.
3. If Node.js 22+, Python 3.9+, or FFmpeg/ffprobe is missing, help install it through the user’s existing package manager, within the setup request. `PREMIERE_ASSISTANT_NODE`, `PREMIERE_ASSISTANT_PYTHON`, `PREMIERE_ASSISTANT_FFMPEG` and `PREMIERE_ASSISTANT_FFPROBE` can point to custom installations. Do not silently change existing package-manager configuration.
4. Install the CEP panel with `setup --install-cep` when needed. This copies the pinned panel and enables Adobe’s unsigned CEP panel preference. A differing existing panel is reported instead of overwritten. Install the generated `premiere-editor-assistant-panel.ccx` through Adobe Creative Cloud, or load the prepared `integrations/quadlzzz/panel/manifest.json` in Adobe UXP Developer Tool. Preserve existing projects before any required Premiere restart. Open Window → Extensions → MCP for Adobe Premiere Pro and Window → UXP Plugins → Premiere MCP Agent.
5. For local transcription and semantic matching on Apple Silicon, use `setup --local-models`. Model weights download when first used. Existing transcripts are also supported. Scribe requires the user’s own ElevenLabs credentials and explicit authorization to send the selected audio; keep credentials outside the plugin. Gemini is deferred and is not configured by setup.
6. Open a project in Premiere. Run `doctor` again, then `smoke --live` through the launcher. A tool-list handshake alone does not prove Premiere is connected. Report any missing panel or version limitation precisely. The broker listens only on loopback; the shipped Adobe panel expects port 3001.
7. Choose a working directory for this project, then use edit-video for Takes/Selects or export-omf for a requested sound handoff. OMF uses the same CEP bridge and standard-library Python helper; it needs no transcription models. Each project keeps its own evidence and journal. Reuse the plugin’s shared runtime across projects.

Runtime data defaults to `~/Library/Application Support/Premiere Editor Assistant/0.1.1` (or the host’s PLUGIN_DATA directory). `PREMIERE_ASSISTANT_DATA` explicitly overrides that location. Package updates must retain project journals and evidence; never clear an uncertain operation to make a retry run.

Bridge JavaScript dependencies use the public npm registry for this installation only. Set `PREMIERE_ASSISTANT_NPM_REGISTRY` for a managed mirror; setup does not edit global npm settings.
