---
name: export-omf
description: Prepare audio-only duplicates of local Premiere Pro sequences and export checked OMF files for a sound editor. Use for OMF export, sound handoff, or repeating an OMF delivery, including Hebrew requests. Requires the Assistant's Premiere CEP bridge.
---

# Export OMF from Premiere

Use the plugin's registered `premiere_cep` tools for the requested sound handoff. Resolve the plugin root two directories above this skill folder and use absolute paths for its resources. Read [the tool procedure](references/procedure.md) before live edits. Use the setup skill if the bridge is unavailable. OMF export does not require transcription or creating Takes/Selects; existing Takes and Selects remain protected source sequences. Its additional audio-only copies are sound-handoff intermediates, separate from the editorial delivery pair.

## Inputs and defaults

Resolve sequence names to unique IDs in the open project and obtain an output directory. Ask only for missing or ambiguous inputs; a request to prepare/export authorizes the described duplicate cleanup and export. Carry forward explicit preferences from this session.

Default preset: 48,000 Hz, 24-bit WAV, embedded audio, trim to used media with 5-second handles, include pan. These are workflow defaults, not a universal delivery specification. Let the user override them. Convert handles using the sequence's actual frame duration, rounding to the nearest frame and reporting fractional-rate rounding. Do not hardcode 125 frames.

Default scope is the full sequence. Duplicate each source, use a collision-free `<source>_OMF_Codex` name, and store its returned ID. Never modify the source. On an explicit rerun/correction, reuse a verified prior working copy if its provenance and current state are known; otherwise make a fresh copy. Never infer ownership from a name suffix alone.

Retain enabled audio clips on included output tracks; preserve their timing, source trims, channel interpretation, speed, effects and transitions. Remove disabled audio without ripple or linked-partner removal. Inspect track-output state. Mixer mute/solo is not equivalent to clip enable or OMF track output: when intent cannot be established, ask which tracks to include before discarding them. Do not infer activity from waveform silence or choose a new main voice.

Preservation of the Premiere copy does not prove preservation in OMF. Inspect nested/multicam audio, routing and effects before export: nested audio is handed off as a clip, and OMF does not carry arbitrary effects or all mixer automation. Resolve a need for separate microphones or rendered processing before changing that structure. Read the procedure's format limits when these features are present.

Remove **all video and graphics clips** from the copy. One empty V1 is acceptable when Premiere's tool requires a last video track. Do not leave titles, overlays, nested video, or adjustment clips behind. Remove empty audio tracks where supported without changing retained-track order.

Before footage-dependent review or cleanup, follow the Assistant's proxy policy: inspect attachment and availability, enable and verify proxy playback when available, and ask for the user's direction if proxies are missing. Independent inspection/preparation can continue while waiting. Playback proxy state does not establish export-audio provenance. Use original audio for the sound handoff by default; using proxy audio requires the user's choice and verified channel coverage. Do not relink source media, regenerate proxies, or change channel interpretation just to make export succeed. Audio-only OMF is a requested sound deliverable; it does not authorize a full-resolution video export.

## Execution and verification

1. Read connection/capabilities and complete snapshots of sources; save a project backup and a small local run record outside the installed plugin with project path, source/copy IDs, intended settings, snapshots and progress. Keep one Premiere writer and reconcile any pending or indeterminate edit in the project's existing execution journal before writing. Preserve the user's current unsaved work when creating a backup; do not describe a stale on-disk copy as a backup of live state.
2. Duplicate, clean audio, clean video/graphics, and verify between phases using the procedure. Activate and check the target ID immediately before active-sequence mutations and export. Process sequences sequentially.
3. Export to fresh staging paths. Check the embedded OMF size limit before export; resolve external audio or another delivery choice when it will not fit. Validate each file before placing it in the requested folder. Preserve previous deliveries unless replacement was requested; explicit replacement uses a backup and verified atomic replacement. For external-media OMF overrides, deliver and verify the entire media set, not only the `.omf`.
4. Verify originals unchanged, retained audio matches, zero video clips remain, and delivered files match the staged checksums. Save the project and restore temporary global proxy settings if changed. Report files, preset, cleanup counts, any remaining empty V1 and material limitations.

Use [scripts/verify_omf.py](scripts/verify_omf.py) for deterministic read-only checks. It compares complete audio snapshots and checks the exported file's size, SHA-256 and Bento container footer. See the procedure for commands and evidence limits. It neither controls Premiere nor proves a DAW import. Do not claim effect/keyframe fidelity or listening verification from a clip-list comparison.

After a failed or timed-out mutation, inspect current state before retrying. If source IDs, active sequence, retained audio, or snapshot completeness cannot be established, stop the affected operation and explain the specific blocker. Do not enable unsafe scripting, remove preview guards, or blindly replay an uncertain export.
