# Premiere Editor Assistant 0.1.6

A local macOS plugin for editable Takes and Selects, with Project-panel organization and a separate OMF sound-handoff skill. English editorial input is validated; optional local transcription requires Apple Silicon. Premiere 26.3.2 was the original tested host.

## Install the plugin

Both agents install the same built package from the public repository.

**Codex:** Run `codex plugin marketplace add AviramV/premiere-editor-assistant`, then install **Premiere Editor Assistant** from the Plugins Directory. Reload/restart the desktop app if needed.

**Claude Code:** Run these commands, then start a new session:

```sh
claude plugin marketplace add AviramV/premiere-editor-assistant
claude plugin install premiere-editor-assistant@premiere-editor-assistant-local
```

For a downloaded ZIP, unzip into a permanent folder and replace `AviramV/premiere-editor-assistant` in the appropriate marketplace command with `"/absolute/path/premiere-editor-assistant"`. Install from that local source using the same steps. Run the plugin’s **setup** skill in the agent you use.

The package uses Agent Plugins 1.0.0 root `plugin.json`, `mcp.json` and `skills/`, with Codex and Claude compatibility manifests and catalogs. Both catalogs point to the package root; their existing marketplace identity is `premiere-editor-assistant-local`. The shared skills and bridge launchers are identical in both agents. This requires local macOS execution; a cloud-only chat cannot reach Premiere on your Mac.

## Prepare dependencies

The guided setup runs `/bin/bash "/absolute/plugin/path/scripts/launch.sh" setup`. It downloads checksum-pinned Premiere bridge runtimes, installs locked JavaScript dependencies and prepares a CCX panel. Node.js 22+, Python 3.9+, and FFmpeg/ffprobe are prerequisites; the doctor reports missing components.

Reuse compatible tools already on the Mac before installing more copies. Desktop apps may have a different PATH from Terminal. The launcher checks common Homebrew, nvm, fnm and Volta Node locations and skips Node versions below 22. Save other/custom executable paths once:

```bash
/bin/bash "/absolute/plugin/path/scripts/launch.sh" configure \
  --node "/absolute/path/to/node" \
  --python "/absolute/path/to/python3" \
  --ffmpeg "/absolute/path/to/ffmpeg" \
  --ffprobe "/absolute/path/to/ffprobe"
```

Supply only the options you need. Each executable is checked before paths are saved. If Node cannot be found initially, prefix this command with `PREMIERE_ASSISTANT_NODE="/absolute/path/to/node"`. Settings live in `~/Library/Application Support/Premiere Editor Assistant/executables`, outside versioned runtimes, and apply to both bridges and workflow commands. Environment overrides take precedence; `PREMIERE_ASSISTANT_CONFIG` can select another absolute settings directory. No shell startup-file changes are required. For missing tools, use your package manager or a verified official installer.

The optional `setup --local-models` adds MLX Whisper and semantic matching dependencies in a separate Python environment. Without it, an existing word transcript or explicitly authorized ElevenLabs (Scribe) may be used. The validated script matcher is English-only. Gemini setup is deferred.

Use `setup --install-cep` for the CEP panel. It enables Adobe’s unsigned CEP panel preference and refuses to overwrite a differing installation. Install the generated CCX through Adobe Creative Cloud or load its manifest in UXP Developer Tool. Open both bridge panels in Premiere. Preserve open projects before restarting Premiere. Run `doctor`, then `smoke --live` through the same launcher; a tool-list handshake alone does not establish a live connection.

## Transcription choices

| Route | Setup requirements |
| --- | --- |
| Premiere native | Create the transcript in Premiere, then verify actual timed words through the bridge. Local Whisper and ElevenLabs credentials are unnecessary. |
| Local Whisper | Optional `setup --local-models` on Apple Silicon; MLX Whisper runs locally after its model weights are downloaded on first use. |
| ElevenLabs (Scribe) | The user's ElevenLabs API key and explicit authorization to upload the selected main-voice audio. Scribe is ElevenLabs' speech-to-text model, not another service. |

The external command's provider IDs remain `mlx-whisper`, `scribe` and `existing`. `existing` reuses a timed transcript file; it is not a fourth transcription service. Premiere-native transcripts are verified separately. External results are imported back into Premiere, so native transcript storage does not identify which service generated the words. See [ElevenLabs' transcription documentation](https://elevenlabs.io/docs/overview/capabilities/speech-to-text).

## Retries, interruptions and alternatives

Run the same setup command again after a recoverable failure. Downloads, npm dependency installation and optional pip installation make at most three attempts for recognized temporary network failures, waiting one then three seconds (or longer when a download server requests it). A server-requested wait longer than a minute is reported for a later rerun instead of retrying early. HTTP authorization/not-found errors, checksum mismatches, certificate errors, unsupported dependencies, permission failures and insufficient disk space require correction first.

Downloaded archives are cached by checksum under the versioned data directory's `downloads/` folder and reverified on reuse. Extraction and dependency stages have content-verified checkpoints under `setup-work-*/`; partial or changed scratch stages are rebuilt. A completed installed runtime is verified and reused. Setup preserves differing installed runtimes and existing CEP panels, along with all project journals. CCX generation uses a temporary file before replacing the generated installer, and a new CEP panel is fully copied and checked before installation.

`setup-status.json` records the last stage/status; `setup-logs/` holds per-run diagnostic logs. Failure output gives the failed stage, attempts, retry command, log path and corrective action. Keep the same managed-mirror/network environment when copying a retry command. Exit code 1 means required setup failed; code 2 means the runtime is prepared with pending installer or optional-model steps. This is never a claim that Adobe panels or the agent's MCP connections are ready.

Setup records process ownership and worker groups. A confirmed dead owner with no surviving workers can be recovered automatically. Active processes, unknown/legacy locks and an interrupted worker-spawn record stop recovery for inspection; setup never blindly clears an uncertain lock. This uses process liveness checks rather than a process-list command.

If Creative Cloud cannot install the CCX, load the reported prepared manifest through Adobe UXP Developer Tool. If local Whisper fails, the prepared runtime remains available for Premiere-native transcription or an existing timed transcript; ElevenLabs (Scribe) requires separate authorization. No fallback uploads audio automatically. If connection reload is unavailable, restart your Codex or Claude Code session and verify both bridges from the chat. `smoke --live` retries recognized temporary connection failures up to three times using read-only calls, closes each attempt, and reports each bridge separately. Editorial mutations and paid transcription requests are outside these setup retries.

## Upgrade from an earlier version

Refresh the marketplace and update the plugin. Run setup for the new 0.1.6 runtime directory; keep previous runtime data and all project journals. The updated UXP panel includes native transcript import, so load it when doctor reports a panel mismatch. External transcription configurations now require the exact Premiere project path, observed UXP source-item ID and the shared execution journal directory; see the edit-video workflow reference. Do not reuse or clear an uncertain operation to bypass reconciliation.

1. Run doctor using the new package's launcher. A missing new runtime marker means setup is needed for that version; it does not mean the previous runtime is broken. Doctor prints executable paths, the data directory, panel mismatches and specific next actions. Missing/outdated Adobe panels block dependency readiness; optional transcription does not.
2. Reuse an older local transcription environment if desired: doctor lists candidate paths without assuming compatibility. Run `configure --python "/older/runtime/python/bin/python"`, then rerun doctor to check imports, including SentencePiece. Keep the referenced older directory. Installed imports do not verify model weights or a real transcription.
3. Install the generated CCX through Creative Cloud when UXP files differ. Setup prints its full path. Alternatively load the prepared `integrations/quadlzzz/panel/manifest.json` in UXP Developer Tool and set `PREMIERE_ASSISTANT_UXP_PANEL` to that panel directory for doctor. Save open projects before a required Premiere restart. The CEP panel needs replacement only if its packaged files differ; setup preserves differing installations for review.
4. Check existing manual MCP entries in user and project configuration for obsolete launcher paths (such as 0.1.0) and duplicate launches of the same bridge. Prefer the current bundled connections; if intentional manual entries are retained, point them at the current launcher and disable only their duplicate bundled servers. Preserve tool restrictions and plugin skills. [Official OpenAI documentation](https://developers.openai.com/plugins/build/plugins) describes plugin-scoped server policy and project configuration.
5. Open both panels and a project, run doctor and `smoke --live`. After startup changes, reload the agent's MCP connections or restart your Codex or Claude Code session, then verify both bridges through read-only tools in the chat. A direct launcher smoke test cannot confirm that the agent adopted its new configuration. If automatic reload is blocked, leave that final step explicitly pending for the user.

Premiere 26.5.2 has a reported read-only connection result from another Mac; this does not extend the original 26.3.2 editorial acceptance. A new Premiere version still needs capability checks before editing.

## Organize a project

Ask **organize-project** to organize your open project into the numbered bins from `00 SEQUENCES` through `07 MATTES`, or to give unclear media items descriptive names. It preserves timelines and disk filenames, verifies a current backup, and shares the project writer lock and recovery journal. Template bins can remain empty. Only video-content review for naming needs the proxy checks; bin moves and naming from known information can proceed independently. See [the organizer skill](skills/organize-project/SKILL.md).

## Start a video

Ask the plugin to prepare Takes and Selects, provide the Premiere project/source sequence and storyboard, and choose a project working folder. If proxies are attached, it enables and verifies the proxy toggle. If they are missing, it asks whether you will attach them or want it to attach proxies from a location you provide.

After external transcription, the workflow imports timed words onto the exact original media item as a native Premiere transcript, verifies readback and saves. Matching native transcripts are reused; conflicts require reconciliation. Editors can later use Premiere’s native Create captions from transcript dialog.

Each project keeps its own inventory, transcript, operation journal and evidence. Shared runtimes default to `~/Library/Application Support/Premiere Editor Assistant/0.1.6`; `PREMIERE_ASSISTANT_DATA` can override this. Custom executables can be provided through `PREMIERE_ASSISTANT_NODE`, `PREMIERE_ASSISTANT_PYTHON`, `PREMIERE_ASSISTANT_FFMPEG` and `PREMIERE_ASSISTANT_FFPROBE`. These are local settings, not values to put in a shared archive.

For a sound handoff, ask export-omf to export your chosen sequence to a destination folder. It prepares a separate audio-only copy and defaults to 48 kHz, 24-bit embedded WAV with five-second handles. It uses the existing CEP bridge and Python standard library. Container checks and audio-metadata comparisons do not prove a successful Pro Tools import; live OMF acceptance remains separate.

Footage, project files, credentials, caches and historical evaluation reports are excluded. No external account is configured automatically. See THIRD_PARTY.md for included and downloaded components.

Bridge JavaScript dependencies use the public npm registry for this installation only. Set `PREMIERE_ASSISTANT_NPM_REGISTRY` for a managed mirror; setup does not edit global npm settings.


Runtime location is shared across Codex, Claude Code and shell setup. Resolution is: explicit `PREMIERE_ASSISTANT_DATA`, the saved location for this package version, then `~/Library/Application Support/Premiere Editor Assistant/<version>`. Host-provided `PLUGIN_DATA` does not change that default. After verifying the pinned runtime, setup atomically records its location under the executable settings directory's `runtimes/<version>` file; custom paths therefore survive agent restarts. Conflicting registrations stop with a reconciliation message and preserve both installations. An explicit environment override still takes precedence for that invocation.

When upgrading from a host-managed installation, doctor reports a legacy `PLUGIN_DATA/<version>` runtime when visible in that environment. To reuse it, run setup with `PREMIERE_ASSISTANT_DATA` set to its exact absolute directory; setup validates the runtime before registering it. Do not move Python environments or erase project journals. If runtime versions/checksums differ, prepare the current version separately. A shell doctor alone cannot prove the agent's environment or tool availability: inspect MCP startup errors for the actual resolved directory before requesting a restart, then verify read-only calls through both chat tools after reload.

Live smoke checks allow up to 20 seconds for the Adobe panel to reconnect while retaining the same MCP client and broker. Only read-only host probes are repeated. A missing panel reports a readiness timeout; unsupported host responses fail immediately. Transport startup retries remain separate. Successful file/dependency checks do not establish live connectivity or chat-tool availability.
