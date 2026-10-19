# Workflow commands

Use `/bin/bash "<plugin-root>/scripts/launch.sh" run "/absolute/project-working-directory" <tool> ...`. The runner preserves that project’s working directory and resolves code from the installed package. Use absolute file paths in JSON configuration. It does not select a project or modify footage implicitly.

Available commands:

| Tool | Arguments / purpose |
| --- | --- |
| workflow | `inspect config.json output.json` reads a sequence; `keep config.json output.json` performs an explicitly planned, guarded keep operation. |
| transcribe | `config.json` extracts the selected main-voice channel, transcribes it and imports the result as a native source transcript. |
| match-takes | `script.json transcript.json matching.json semantic` or `lexical`; semantic requires the optional Python environment. |
| assess-takes | `config.json`; source-level audio measurements require `extraction.normalize: false`. |
| audit-coverage | `config.json`; compares script passages, source placements and recorded performances. |
| deliver | `config.json plan`, then `config.json execute` to create Takes; prepare Takes colors/cameras/audio, then `config.json selects` to derive Selects. |
| audio-cleanup | `config.json plan` or `execute`; preserves main voice and handles redundant tracks through revision guards. |
| native-label-session | `config.json`; owns the edit lock while the agent applies each prepared native label group and verifies saved labels. |
| native-camera-session | `config.json`; explicitly requested camera changes, with native verification. |
| reconcile-native-labels | `config.json`; inspect a prior interrupted label operation before considering further mutations. |
| recover-parked-reorder | `config.json`; bounded recovery after proving the current state matches the recorded operation. |
| read-project | `--project file.prproj --sequence ID --output file.json`; read-only saved project inspection. |

The bundled `workflow/src` modules and `workflow/tools` CLIs are the executable schema reference. Read only the relevant tool and planner for a task. The package intentionally excludes earlier project fixtures and acceptance scripts that embed personal project paths.

## Inspection and delivery configuration

Start with a current project inspection through the `premiere_cep` MCP tools. Confirm the project path and source sequence ID. Read a normalized snapshot with `workflow inspect`; its configuration requires `projectPath`, `sequenceId`, and `protectedIds` (include every source sequence). Never invent IDs.

The delivery configuration has:

```json
{
  "projectPath": "/absolute/project.prproj",
  "sequenceId": "observed-source-sequence-id",
  "protectedIds": ["observed-source-sequence-id"],
  "journalDirectory": "/absolute/working-directory/execution",
  "placement": {"kind": "audio", "track": 0, "sourceId": "observed-main-voice-item-id", "startTicks": "observed-placement-start-ticks"},
  "transcriptFile": "/absolute/working-directory/transcript.json",
  "inventoryFile": "/absolute/working-directory/inventory.json",
  "voiceSources": [],
  "extraTailFrames": 4,
  "takesBoundaryMode": "strict",
  "planFile": "/absolute/working-directory/delivery-plan.json",
  "evidenceFile": "/absolute/working-directory/delivery-evidence.json",
  "outputs": {
    "takes": {"name": "Takes", "prefix": "unique-operation-prefix-takes"},
    "selects": {"name": "Selects", "prefix": "unique-operation-prefix-selects"}
  }
}
```

Replace each example value with observed project state and this run’s working paths. An operation prefix is unique for a new edit; it must not be changed to bypass an uncertain earlier operation. Each additional `voiceSources` entry has its own `transcriptFile` and exact `placement`.

An inventory records `sourceRevision` (normalized sequence revision), `transcriptRevision`, and `parts`. Each part has `id`, `hook`, `identityEvidence`, `selectedTakeId`, and `takes`. Each take has `id`, `performanceKey`, `sourceRevision`, `firstWord`, `lastWord`, and `usability: {status, reason}`. These are observed/reviewed decisions, not fields to fill with defaults. Consult `workflow/src/editorial/delivery.mjs` and `speech-boundary.mjs` for additional voice revisions and evidence-bound boundary overrides.

`deliver execute` creates Takes only and writes its identity and the pair revision to `evidenceFile`. Finish Takes native colors, camera choices and audio routing before running `deliver selects` with the same configuration. This duplicates prepared Takes, removes alternatives and trims selected boundaries, clears only the duplicate's inherited markers and adds Selects markers. It performs no Selects reorder or native color application. An optional `takesSequenceId` can use an existing prepared Takes; its geometry must match the current plan. Never change names or prefixes to bypass an uncertain operation.

The `selects` stage reads freshly saved native instances, refuses incomplete or wrong Takes colors, and verifies inherited colors, cameras, audio channel groups, source clocks and effect/keyframe fingerprints. It also checks that Takes and the original source are unchanged. A selected interval outside usable Takes stops planning for inventory reconciliation. A success still leaves actual proxy exports and save/close/reopen acceptance pending; continue those checks before calling the delivery complete. Keep source IDs protected throughout.

## Transcription configuration

`transcribe` accepts `extraction` (input proxy, output mono WAV, stream/channel, interval, sample rate and normalization), `providers`, `cacheDirectory` and `output`. Providers are `mlx-whisper`, `existing` with a transcript `path`, or authorized `scribe`. The local provider uses the setup environment and bundled helper; custom `python` and `model` remain configurable. Set `ELEVENLABS_API_KEY` in the calling environment when using Scribe; never put it in distributed examples. The matching planner validates English script JSON with `language: "en"` and nonempty `passages` with unique IDs and text.

External transcription also requires this target, resolved from current Premiere state:

```json
{
  "premiere": {
    "projectPath": "/absolute/project.prproj",
    "clipId": "observed-uxp-original-media-item-id",
    "journalDirectory": "/absolute/working-directory/execution"
  }
}
```

Use the UXP project-item ID (for example from `ppro_transcript_probe`); CEP IDs are not interchangeable. The extraction input must be that item's original media or its currently attached proxy, with the same media clock. Nested, merged and multicam source items require mapping to the underlying media first. Normalized word times already contain the extraction offset; do not add it twice or use timeline positions. The bridge checks exact media/proxy paths. Channel selection is established by microphone assessment and extraction, not inferred from the import API.

The command retains the normalized transcript and raw provider cache, writes `<output>.premiere.json` in Adobe's import schema, and calls the packaged `ppro_transcript_import`. Its read-only `mode: "inspect"` checks availability, target identity and existing content. `mode: "import"` refuses conflicting existing transcripts, imports absent ones, verifies timed-word readback and saves the project. Matching transcripts are reused. External cache reuse still runs this step. `<output>.premiere-import.json` and the shared journal record verification. A failure exits unsuccessfully and leaves transcription files available; an uncertain dispatch must be inspected and reconciled before another mutation. Existing transcription configurations must add `premiere`; missing targets fail before audio extraction or paid transcription.

For transcripts already created by Premiere, verify actual timed words in the native source transcript and skip external transcription/import. `hasTranscript` alone is insufficient: Premiere can report a transcript containing only empty segment placeholders. Never infer native provenance from provider name `existing` alone. Before continuing, verify the Text panel and save/reopen persistence; check actual Takes/Selects sequence transcript coverage after editing, especially nesting. The automated receipt proves import readback and a save call, not reopening or caption readiness on every derived sequence.

Adobe documents [transcript JSON import and import actions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript) from 25.6, with `hasTranscript` from 26.3. The bridge probes actual runtime methods. [Adobe's sample schema](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/assets/transcript_format_spec.json) defines timed words, segments and speakers. Once the final sequence transcript is verified, an editor can use [Create captions from transcript](https://helpx.adobe.com/in/premiere/desktop/add-text-images/insert-captions/create-captions.html). The current bridge does not expose native caption generation; transcript preparation does not create caption tracks.

## Acceptance limits

The core workflow had 128 automated tests and live Premiere 26.3.2 acceptance before packaging. That evidence applies to the original tested workstation. A relocated package’s handshake test verifies server startup and tool discovery; `smoke --live` adds read-only Premiere response checks. Native colors, listening quality, editing, rendering and persistence on another machine remain separate checks. Gemini, finishing graphics, captions, music, B-roll and independent raw-media synchronization remain later phases.
