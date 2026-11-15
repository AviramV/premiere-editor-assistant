# Premiere Editor Assistant 0.2.0

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

Managed installations share checksum-verified archives in the store's `downloads/` directory and verified extraction/dependency checkpoints in `scratch/<runtime-id>/work`. Explicit custom runtime directories retain their existing download/checkpoint layout. Partial or changed scratch stages are rebuilt. A completed installed runtime is verified and reused. Setup preserves differing installed runtimes and existing CEP panels, along with all project journals. CCX generation uses a temporary file before replacing the generated installer, and a new CEP panel is fully copied and checked before installation.

`setup-status.json` records the last stage/status; `setup-logs/` holds per-run diagnostic logs. Failure output gives the failed stage, attempts, retry command, log path and corrective action. Keep the same managed-mirror/network environment when copying a retry command. Exit code 1 means required setup failed; code 2 means the runtime is prepared with pending installer or optional-model steps. This is never a claim that Adobe panels or the agent's MCP connections are ready.

Setup records process ownership and worker groups. A confirmed dead owner with no surviving workers can be recovered automatically. Active processes, unknown/legacy locks and an interrupted worker-spawn record stop recovery for inspection; setup never blindly clears an uncertain lock. This uses process liveness checks rather than a process-list command.

If Creative Cloud cannot install the CCX, load the reported prepared manifest through Adobe UXP Developer Tool. If local Whisper fails, the prepared runtime remains available for Premiere-native transcription or an existing timed transcript; ElevenLabs (Scribe) requires separate authorization. No fallback uploads audio automatically. If connection reload is unavailable, restart your Codex or Claude Code session and verify both bridges from the chat. `smoke --live` retries recognized temporary connection failures up to three times using read-only calls, closes each attempt, and reports each bridge separately. Editorial mutations and paid transcription requests are outside these setup retries.

## Upgrade from an earlier version

Refresh the marketplace and update the plugin, then run this package's setup. Compatible releases reuse the same managed bridge runtime. Setup prepares the matching shared bridge and verifies any reusable legacy components. Compatible old Python environments are adopted in place when no explicit interpreter is configured. Historical cleanup follows verification; project journals keep their existing paths. Install and reload the generated UXP panel 0.2.0 when doctor reports a mismatch. It includes transcript import and a read-only report of its loaded folder, which historical cleanup requires. The Adobe panel has its own version; plugin-only updates can reuse an unchanged panel. External transcription configurations now require the exact Premiere project path, observed UXP source-item ID and the shared execution journal directory; see the edit-video workflow reference. Do not reuse or clear an uncertain operation to bypass reconciliation.

1. Run doctor using the new package's launcher. A missing matching runtime marker means setup is needed; it does not mean the previous runtime is broken. Doctor prints executable paths, the data directory, panel mismatches and specific next actions. Missing/outdated Adobe panels block dependency readiness; optional transcription does not.
2. Setup checks legacy Python environments for imports and the current package requirements before adopting one at its original path. An explicit configured interpreter takes precedence. Doctor still lists unselected candidates without assuming compatibility; use `configure --python "/older/runtime/python/bin/python"` for an intentional choice, then rerun doctor. Referenced environments remain in place. These checks do not verify model weights or a real transcription.
3. Install the generated CCX through Creative Cloud when UXP files differ. Setup prints its full path. Alternatively load the prepared `integrations/quadlzzz/panel/manifest.json` in UXP Developer Tool and set `PREMIERE_ASSISTANT_UXP_PANEL` to that panel directory for doctor. Save open projects before a required Premiere restart. The CEP panel needs replacement only if its packaged files differ; setup preserves differing installations for review.
4. Check existing manual MCP entries in user and project configuration for obsolete launcher paths (such as 0.1.0) and duplicate launches of the same bridge. Prefer the current bundled connections; if intentional manual entries are retained, point them at the current launcher and disable only their duplicate bundled servers. Preserve tool restrictions and plugin skills. [Official OpenAI documentation](https://developers.openai.com/plugins/build/plugins) describes plugin-scoped server policy and project configuration.
5. Open both panels and a project, run doctor and `smoke --live`. After startup changes, reload the agent's MCP connections or restart your Codex or Claude Code session, then verify both bridges through read-only tools in the chat. A direct launcher smoke test cannot confirm that the agent adopted its new configuration. If automatic reload is blocked, leave that final step explicitly pending for the user.

Premiere 26.5.2 has a reported read-only connection result from another Mac; this does not extend the original 26.3.2 editorial acceptance. A new Premiere version still needs capability checks before editing.

## Organize a project

Ask **organize-project** to organize your open project into the numbered bins from `00 SEQUENCES` through `07 MATTES`, or to give unclear media items descriptive names. It preserves timelines and disk filenames, verifies a current backup, and shares the project writer lock and recovery journal. Template bins can remain empty. Only video-content review for naming needs the proxy checks; bin moves and naming from known information can proceed independently. See [the organizer skill](skills/organize-project/SKILL.md).

## Start a video

Ask the plugin to prepare Takes and Selects, provide the Premiere project/source sequence and storyboard, and choose a project working folder. If proxies are attached, it enables and verifies the proxy toggle. If they are missing, it asks whether you will attach them or want it to attach proxies from a location you provide.

After external transcription, the workflow imports timed words onto the exact original media item as a native Premiere transcript, verifies readback and saves. Matching native transcripts are reused; conflicts require reconciliation. Editors can later use Premiere’s native Create captions from transcript dialog.

Each project keeps its own inventory, transcript, operation journal and evidence outside the plugin and runtime store. Shared dependencies default to `~/Library/Application Support/Premiere Editor Assistant`; `PREMIERE_ASSISTANT_STORE` selects another absolute store for both agents. `PREMIERE_ASSISTANT_DATA` explicitly selects a custom bridge runtime directory. Custom executables can be provided through `PREMIERE_ASSISTANT_NODE`, `PREMIERE_ASSISTANT_PYTHON`, `PREMIERE_ASSISTANT_FFMPEG` and `PREMIERE_ASSISTANT_FFPROBE`. These are local settings, not values to put in a shared archive.

For a sound handoff, ask export-omf to export your chosen sequence to a destination folder. It prepares a separate audio-only copy and defaults to 48 kHz, 24-bit embedded WAV with five-second handles. It uses the existing CEP bridge and Python standard library. Container checks and audio-metadata comparisons do not prove a successful Pro Tools import; live OMF acceptance remains separate.

Footage, project files, credentials, caches and historical evaluation reports are excluded. No external account is configured automatically. See THIRD_PARTY.md for included and downloaded components.

Bridge JavaScript dependencies use the public npm registry for this installation only. Set `PREMIERE_ASSISTANT_NPM_REGISTRY` for a managed mirror; setup does not edit global npm settings.


## Shared dependencies and cleanup

Codex, Claude Code and shell setup use one runtime manager. Bridge directories are selected by the pinned dependencies, patches, installer recipe, operating system, architecture and Node ABI. A plugin version bump alone does not allocate another bridge. Managed bridge files are installed in a verified stage before becoming available; existing installations are never patched in place by setup.

The store separates `bridges/<runtime-id>`, `models/<environment-id>`, shared `downloads/`, temporary `scratch/`, setup reports under `setup/<runtime-id>`, persistent application evidence under `state/`, and installation references/usage leases. `PREMIERE_ASSISTANT_STATE` can select another absolute persistent-state directory. Existing legacy evidence stays in its original location. Python environments are created directly at permanent paths based on their requirements, interpreter and platform. Explicit configured Python paths keep precedence. When none is configured, setup can adopt a compatible historical environment after import and version checks; setup never moves a virtual environment. Model weights retain their provider's existing cache location.

`PREMIERE_ASSISTANT_DATA` overrides the bridge directory. A successful custom setup saves that choice for the package version under the executable settings directory's `runtime-overrides/`; older `runtimes/<version>` registrations remain preserved and are migration candidates. A saved custom choice survives agent restarts. An environment override takes precedence, and conflicting custom registrations stop for reconciliation. `PLUGIN_DATA` does not select the shared store; when supplied, its old versioned runtime is another migration candidate. Set a custom `PREMIERE_ASSISTANT_STORE` consistently in both hosts if using one.

After doctor and both read-only bridge checks succeed, `smoke --live` records this installation as healthy and attempts cleanup. It retains each agent installation's current dependencies and last healthy shared rollback, dependencies of registered releases still present in a host cache, configured executables and runtime pins, declared/loaded panel paths, active processes and surviving workers. Unreferenced managed bridges and Python environments have a seven-day grace period; scratch and valid cached archives have thirty-day retention. Host caches, model weights, persistent application evidence and explicit custom runtime directories remain outside reclamation.

## Migrate historical 0.1.x installations

This release adds cleanup for the old version folders. The new runtime contains a checksum-protected baseline from its verified archives and locked dependencies. Cleanup removes only old support files matching that baseline or validated historical installer receipts. Edited files, unrecognized contents and project evidence remain at their original paths. Python environments stay in place; configured or adopted ones remain available to the new release.

On the first successful upgrade, keep the newest verified old setup as a rollback. Once a healthy shared-runtime rollback exists, that final unreferenced historical setup can also be retired. A user upgrading only from 0.1.7 therefore keeps one initial backup; a user with many releases can reclaim the older duplicate support files immediately after verification. Active/pinned old host installations and intentional custom runtime locations keep their dependencies.

Use `smoke --live --preview-cleanup` to verify the new setup and inspect the proposed cleanup before removal. Then run `cleanup --apply`. A normal `smoke --live` applies the same policy automatically. Historical apply requires a fresh report from the loaded UXP panel and fresh process/open-file checks. Missing panel provenance, multiple Premiere instances, incomplete process information, old setup locks and uncertain references defer historical deletion. Resolve the reported condition rather than clearing ownership records.

Recognized setup logs and status files are copied and checksum-verified under `migration-history/` before their old copies are removed. Obsolete runtime-discovery registrations are archived after their old support files are retired. Project journals and evidence under old `workflow/` folders are kept in place. A remaining old version folder can therefore contain needed Python or project data, changed files, or an intentionally retained backup; the preview lists those reasons.

Preview cleanup without deleting anything:

```sh
/bin/bash "/absolute/plugin/path/scripts/launch.sh" cleanup
```

Use `cleanup --apply` after successful verification for this installation. It rechecks the loaded panel location for historical cleanup. Deletion first records a scoped inventory and quarantines owned data while holding the reference/lease lock. Historical quarantines remain on their source filesystem, so migration also supports a shared store on another volume. An interrupted deletion is checked and resumed on the next apply; uncertain or changed quarantined data remains available for inspection. A cleanup warning does not undo a verified runtime installation. Never bypass an uncertain lease or remove a referenced old Python directory to reclaim space.

For UXP Developer Tool, keep `PREMIERE_ASSISTANT_UXP_PANEL` set to the exact loaded panel directory so doctor and runtime references protect it. Do not replace a loaded panel silently. A shell doctor or direct launcher smoke cannot prove the agent adopted its startup configuration: inspect MCP startup errors before requesting a restart, then verify read-only tools in both agents after reload.

Live smoke checks allow up to 20 seconds for the Adobe panel to reconnect while retaining the same MCP client and broker. Only read-only host probes are repeated. A missing panel reports a readiness timeout; unsupported host responses fail immediately. Transport startup retries remain separate. Successful file/dependency checks do not establish live connectivity or chat-tool availability.

## Premiere connection and editing recovery

Use the shared [host recovery procedure](skills/setup/references/host-recovery.md). Ordinary editing and project persistence checks do not require quitting Premiere. Diagnose the affected bridge, preserve uncertain operation evidence, and recover the smallest affected component before considering a documented application restart.
