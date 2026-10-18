# Premiere tool procedure

Use the currently registered tool schemas as authority. The plugin registers the CEP backend as `premiere_cep`; its full MCP prefix depends on the host. Check `verify_premiere_connection({backend:"cep"})` and inspect `get_capabilities` for inspection, duplicate/rename, preview/apply, track deletion, in/out clearing, saving and OMF export. These schemas were checked against the packaged, pinned leancoder 1.21.0 runtime; this is not live OMF acceptance. A connection failure routes to the plugin's setup skill; do not silently switch bridges or bootstrap another runtime. No new server or unsafe-script permission is needed.

## Complete evidence

Use `get_project_info`, `list_sequences`, and `get_full_sequence_info` with explicit sequence IDs. Snapshot audio and video separately using only `track_type`, `clip_limit` and `clip_offset`; do not narrow by track index or time. `clip_limit:200` can still be shortened by the response budget. Follow `pagination.nextOffset` with identical filters until exhausted. Verify sequence identity, settings and track headers agree across pages; merge clips by track/index, require unique node IDs and indices, and require each merged count to equal `clipCount`. Inconsistent duplicate entries or changed headers require a fresh read. Check transition/effect truncation too. Never label a partial page a complete snapshot.

The helper accepts the unwrapped `data` object for one complete sequence snapshot, including `id` and `audioTrackCount`/`videoTrackCount`. For merged pages, retain all track metadata/clips/transitions and update the merged pagination receipt to `offset:0`, `returned` equal to that kind's total clip count, `truncated:false`, `nextOffset:null` only after counts have been checked. Preserve raw pages as evidence. A last page's `truncated:false` alone is not completeness.

Capture source metadata, in/out, zero point, full audio/video geometry and transitions. Capture more detailed clip/effect data through available supported tools when required to verify automation or channel settings; `effects:["Volume"]` contains names, not parameter values. `get_full_sequence_info` exposes track `isMuted`, but does not independently establish mixer solo, output routing, nested audio contents or channel interpretation. Inspect these through supported tools/UI when relevant; never invent missing state. Compare source snapshots before/after, ignoring only transient UI state such as playhead and selection. The helper compares cleanup audio, not complete source-sequence invariance.

## Copy and audio cleanup

`duplicate_sequence({sequence_id})` returns the new sequence ID. Resolve its corresponding project-item node ID through inspection before calling `rename_project_item`; a sequence ID is not a project-item node ID. Verify the new name and sequence ID via `list_sequences`. Naming collisions must not select a pre-existing unrelated copy. Compare the complete audio copy with its source before any cleanup.

Immediately before active-sequence operations call `set_active_sequence({sequence_id:copyId})` and check the returned ID. Named inspection and preview operations can change or restore public/QE active state; do not assume the last named read selected the correct sequence for later track deletion.

Build deletion plans against clip node IDs from the **copy's** snapshot:

```json
{"sequence_id":"COPY_ID","operations":[{"type":"remove_clip","node_id":"COPY_CLIP_NODE_ID","include_linked":false,"ripple":false}]}
```

Batch at most 100 operations. Call `preview_edit_plan`, require validated targets, then `apply_edit_plan` with the exact plan and returned confirmation token. Verify per-operation results. Re-snapshot before building the next batch after changes.

Delete empty audio tracks with `delete_track({track_type:"audio",track_index:i,force:false})` in descending index order, checking the active copy each time. Derive indices from current evidence. Track names may auto-renumber; compare retained track order and contents rather than old numeric indices/default display names. Capture transitions touching removed clips and resolve them explicitly; do not silently waive transition mismatches.

## Video and graphics cleanup

Preview may refuse graphics that lack stable source identities. For the user's authorized removal of all video, the tested supported path is deleting whole video tracks, highest index first, with `delete_track({track_type:"video",track_index:i,force:true})`. Verify the active copy before every call and audio preservation afterward. Do not use this for any source sequence.

The tested tool refuses to remove the final video track. Clear its remaining clips via preview/apply with `include_linked:false,ripple:false`. If graphics on that last track cannot be bound safely, use another supported verified operation or UI path; otherwise stop and report the unresolved clips. Never bypass identity checks with raw scripts. An empty final V1 is expected, not a failed cleanup.

Read all video pages afterward and require zero clips. Verify retained audio unchanged from the post-audio-cleanup snapshot. Removing video may shorten sequence end if it previously extended beyond audio; compare the actual audio geometry and intended delivery range, not merely duration equality. Do not pad or time-shift audio without instruction.

## Export and delivery

Check all retained original audio is online and available, including sources inside nested/multicam items. Verify the copy's retained audio against the approved expectation and require zero video clips immediately before export. Recheck the project path and active copy ID at this point; named reads may have changed active state.

Clear in/out on the copy only using `clear_sequence_in_out({clear_in:true,clear_out:true})` for full-sequence delivery. Preserve zero point/timecode and source in/out. Confirm the resulting range, especially if the source has a video-only tail.

For the default preset call `export_omf` on the verified active copy:

```json
{
  "output_path":"ABSOLUTE_FRESH_STAGING_PATH.omf",
  "sample_rate":48000,
  "bits_per_sample":24,
  "audio_encapsulated":true,
  "audio_file_format":1,
  "trim_audio_files":true,
  "handle_frames":125,
  "include_pan":true,
  "timeout_minutes":10
}
```

Here **125 is only the 25-fps example**: compute `round(handleSeconds / frameRate.seconds)` from the actual sequence and user-requested handle seconds. Report the actual duration represented by the rounded frame count. Handles cannot exceed available source media. Adjust timeout to sequence length; after a timeout inspect export progress/files before taking another action. `export_omf` can return `success:true` with `outcome:"committed_unverified"` after a timeout; file presence or that receipt is not completion. Wait for Premiere to finish and confirm stable size/modification time before validating. Read export logs for missing media or other delivery warnings.

Use unique staging names to avoid Premiere's overwrite dialog. Verify file readiness with the export result and `verify_delivery_file`, then the helper. A footer failure means unverified delivery; never patch an exported file to make validation pass. For unsupported container variants use an appropriate reader and state that this helper did not validate them.

For replacement: back up existing deliverables, copy staging to a uniquely named temporary sibling in the destination, verify checksum, and atomically replace the final file. Preserve an existing export if any step fails. Do not move media out from under an external-reference OMF. Keep scope to requested filenames/folder.

For separate audio, use a dedicated delivery subfolder and preserve relative layout. Inventory every referenced audio file with size and checksum, verify after copying, and retain staging until links resolve from the final location. The OMF container helper does not enumerate or verify external references.

## Format limits

Consult Adobe's [OMF supported features](https://helpx.adobe.com/ca/premiere/desktop/render-and-export/export-files/supported-features-for-exporting-omf-files-for-pro-tools.html) and [export procedure](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-omf-files-for-pro-tools.html) when a requested handoff depends on them:

- An OMF cannot exceed 2 GB. Estimate embedded PCM from retained channel-seconds including handles, sample rate and bytes per sample, leaving room for container overhead. If too large or close to the limit, resolve separate audio or a user-chosen alternative; do not silently shorten handles, split the edit or substitute AAF.
- Multichannel audio becomes mono tracks; nested sequences export as clips, without promising separate underlying microphones. Preserve the Assistant's prepared routing and resolve any request to expose nested sources separately.
- Clip gain, volume keyframes and supported transitions have defined translations. Mixer pan exports one value per clip; arbitrary effects, mixer balance and some channel-gain/effect keyframes do not transfer. Preserve effects on the copy, disclose relevant export limits, and resolve required rendering with the user rather than stripping or baking processing automatically.
- Track Output controls inclusion; Audio Mixer mute/solo does not. Inspect actual output state and explicit intent before excluding audio. A nonempty file cannot prove all intended tracks were included.

Premiere does not import OMF. Target-DAW import and listening are separate acceptance; do not claim them from a container footer or compare against a different sound format without instruction.

## Read-only helper commands

Use the configured `PREMIERE_ASSISTANT_PYTHON` or an available Python 3.9+ runtime; the helper requires only the standard library. Resolve the following helper paths to absolute paths from this skill directory. Store run records and snapshots in the project working folder, outside the installed plugin. Snapshots are complete `get_full_sequence_info.data` JSON objects.

```sh
python3 scripts/verify_omf.py audio before-audio.json cleaned-audio.json --mode retained
python3 scripts/verify_omf.py audio cleaned-audio.json after-video-audio.json --mode unchanged
python3 scripts/verify_omf.py video after-video.json
python3 scripts/verify_omf.py file /absolute/path/export.omf
```

`retained` filters only explicitly disabled clips and omits empty tracks. It refuses muted or unknown-state nonempty tracks rather than guessing the user's intended mix. If inclusion was explicitly resolved, derive a separate expected-audio snapshot from that recorded decision and use `unchanged`, which compares known mute states without requiring them to be off. Preserve raw evidence and document each exclusion in that derived expectation; never edit actual observations to force a pass. Neither mode permits missing/partial evidence. Transitions are compared exactly after removing their collection indices; if deletion legitimately changes a transition, verify and document that change separately.

The audio comparison checks exposed clip placement, source identity/trims, enable state, speed, effect names and transition geometry. It ignores new timeline node IDs, clip collection indices, selection and track names/renumbering. Verify intended custom track names separately. It does not verify hidden effect parameters, channel mapping, routing, audio rendering, or OMF import in Pro Tools. File checking checks a little-endian Bento TOC/footer's bounds and SHA-256, not OMF objects, audio content, preset conformance or DAW compatibility; unsupported container variants remain unverified. Report these limits accurately.
