# Premiere Editor Assistant 0.1.2

A local macOS plugin for editable Takes and Selects, with a separate OMF sound-handoff skill. English editorial input is validated; optional local transcription requires Apple Silicon. Premiere 26.3.2 was the original tested host.

## Install the plugin

Unzip this package into a permanent folder. It includes its own local marketplace catalog. Register the extracted folder with `codex plugin marketplace add "/absolute/path/premiere-editor-assistant"`, then reload/restart the desktop app when needed and install **Premiere Editor Assistant** from that local source in the Plugins Directory. Run the plugin’s **setup** skill.

If using a repository marketplace instead, copy the extracted folder to `plugins/premiere-editor-assistant` and add that path to the repository’s `.agents/plugins/marketplace.json`. The package has both the portable Agent Plugins manifest and the Codex compatibility manifest. This is a local desktop integration; a cloud-only chat cannot reach Premiere on your Mac.

## Prepare dependencies

The guided setup runs `/bin/bash "/absolute/plugin/path/scripts/launch.sh" setup`. It downloads checksum-pinned Premiere bridge runtimes, installs locked JavaScript dependencies and prepares a CCX panel. Node.js 22+, Python 3.9+, and FFmpeg/ffprobe are prerequisites; the doctor reports missing components.

The optional `setup --local-models` adds MLX Whisper and semantic matching dependencies in a separate Python environment. Without it, an existing word transcript or explicitly authorized ElevenLabs Scribe may be used. The validated script matcher is English-only. Gemini setup is deferred.

Use `setup --install-cep` for the CEP panel. It enables Adobe’s unsigned CEP panel preference and refuses to overwrite a differing installation. Install the generated CCX through Adobe Creative Cloud or load its manifest in UXP Developer Tool. Open both bridge panels in Premiere. Preserve open projects before restarting Premiere. Run `doctor`, then `smoke --live` through the same launcher; a tool-list handshake alone does not establish a live connection.

## Upgrade from 0.1.1

Refresh the marketplace and update the plugin. Run setup for the new 0.1.2 runtime directory; keep previous runtime data and all project journals. The updated UXP panel includes native transcript import, so load it when doctor reports a panel mismatch. External transcription configurations now require the exact Premiere project path, observed UXP source-item ID and the shared execution journal directory; see the edit-video workflow reference. Do not reuse or clear an uncertain operation to bypass reconciliation.

## Start a video

Ask the plugin to prepare Takes and Selects, provide the Premiere project/source sequence and storyboard, and choose a project working folder. If proxies are attached, it enables and verifies the proxy toggle. If they are missing, it asks whether you will attach them or want it to attach proxies from a location you provide.

After external transcription, the workflow imports timed words onto the exact original media item as a native Premiere transcript, verifies readback and saves. Matching native transcripts are reused; conflicts require reconciliation. Editors can later use Premiere’s native Create captions from transcript dialog.

Each project keeps its own inventory, transcript, operation journal and evidence. Shared runtimes default to `~/Library/Application Support/Premiere Editor Assistant/0.1.2`; `PREMIERE_ASSISTANT_DATA` can override this. Custom executables can be provided through `PREMIERE_ASSISTANT_NODE`, `PREMIERE_ASSISTANT_PYTHON`, `PREMIERE_ASSISTANT_FFMPEG` and `PREMIERE_ASSISTANT_FFPROBE`. These are local settings, not values to put in a shared archive.

For a sound handoff, ask export-omf to export your chosen sequence to a destination folder. It prepares a separate audio-only copy and defaults to 48 kHz, 24-bit embedded WAV with five-second handles. It uses the existing CEP bridge and Python standard library. Container checks and audio-metadata comparisons do not prove a successful Pro Tools import; live OMF acceptance remains separate.

Footage, project files, credentials, caches and historical evaluation reports are excluded. No external account is configured automatically. See THIRD_PARTY.md for included and downloaded components.

Bridge JavaScript dependencies use the public npm registry for this installation only. Set `PREMIERE_ASSISTANT_NPM_REGISTRY` for a managed mirror; setup does not edit global npm settings.
