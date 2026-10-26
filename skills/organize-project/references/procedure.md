# Project organization tools and recovery

## Connection and complete inventory

Discover `get_capabilities` with `tool_query: "project bins move rename backup proxy"` and `tool_limit: 10`, then inspect the schemas of the actual operations needed. The plugin's CEP server is `premiere_cep`; host prefixes vary. Verify `verify_premiere_connection({backend:"cep"})`. A capabilities list does not establish a host connection. Do not change bridges, provision another runtime or enable raw scripting to fill a missing capability.

Read `get_project_info`, `list_sequences` and `get_bin_contents`. For a bounded tree, start with `{bin_id:"/",recursive:false,offset:0,limit:100}` and page each bin's direct children separately. Follow `pagination.nextOffset` while `hasMore` is true; confirm unique IDs, parent identity, consistent `totalDirectItems`, and that merged counts equal that total. Root pagination does not establish that nested bins were read. Recursive depth limits and truncated responses cannot establish a complete inventory. Refresh an inconsistent inventory before planning writes.

Sequence IDs and Project-item node IDs are different. Resolve their mapping from supported sequence/item details; use Project-item node IDs for bin moves and renames. Keep ambiguous duplicate names separate. Classify AE comps, titles, mattes and adjustment sources only with supporting item/type information, observed use or editor context. If unavailable, leave the item in place and report it.

Capture proxy attachment/path information through available supported media-inspection tools and verify referenced files exist. A `hasProxy` flag alone does not establish availability. Record labels and proxy evidence by source-item ID, using null/unknown for fields the host cannot expose rather than pretending they are empty or unchanged. Do not request unrelated raw metadata packets. Missing proxy evidence blocks video-content review, not independent bin organization; report any narrower final verification scope.

## Shared writer and journal

Use the same project-specific `journalDirectory` used by edit-video, native transcription or OMF work. Resolve it from the existing task/project configuration; ask only if multiple directories or ownership are ambiguous. Never choose a fresh directory to bypass a pending operation. Evidence stays outside the installed plugin.

The bundled helper only manages local coordination and records evidence supplied by the agent. It does not connect to Premiere, inspect media, make native edits or prove that a readback is correct.

Start it as a persistent terminal process, with input kept open:

```sh
node "/absolute/plugin/skills/organize-project/scripts/session.mjs" "/absolute/project.prproj" "/absolute/project-journal"
```

Wait for its JSON `ready` response before any project write, including save or a temporary proxy-toggle change. Keep that process alive until the final checks. It exclusively holds the same `writer.lock` file used by the coordinator, with its real live PID, and writes an `organize_project` entry into the shared `journal.json`. Existing `dispatched`, `indeterminate` or `ui_pending` entries block startup. An existing lock is never automatically removed by this helper.

Send newline-delimited JSON commands to its stdin. Use stable, unique operation IDs. Record intentions before the corresponding host call, then record fresh readback after it:

```json
{"action":"dispatch","id":"move-001","operation":{"tool":"move_items_to_bin","item_ids":["ITEM_ID"],"target_bin":"BIN_ID"}}
{"action":"verify","id":"move-001","observed":{"itemId":"ITEM_ID","parentId":"BIN_ID"}}
```

Save, backup, create-bin, rename and authorized proxy-toggle writes use the same dispatch/readback pattern. A `verify` command records evidence; its success does not itself verify Premiere. Keep complete raw responses and inventory snapshots beside the journal, with their paths in the run summary.

After all operations and final checks are verified:

```json
{"action":"finish","summary":{"inventory":"/absolute/project-journal/organizer-after.json","orderVerified":true}}
```

`finish` refuses unresolved operations. For a failed, partly committed or unknown mutation, send `{"action":"fail","reason":"Describe the operation and unresolved outcome"}` and stop project writes, including save. Process termination or lost stdin also leaves an indeterminate shared entry. Never submit `verify` just to unblock the session.

Reconciliation requires current project/item evidence: inspect every attempted item and compare with the recorded intentions and baseline; resolve any pending timeline/transcript edit with its owning workflow. Record the proven result in the original journal, retaining the failed response and history. Remove an abandoned lock only after verifying its owner is no longer running and the journal outcome has been reconciled. Do not invent a successful result, clear the journal, blindly replay operations or automatically restore a project backup over the editor's work.

## Save, backup and mutations

Recheck exact project path before every mutation batch. Capture current state, then use `save_project` and check its result before `create_project_backup({project_path:observedPath})`. Require verified byte identity and retain the returned backup path. An unsaved project without an exact path needs a user-chosen save destination first. If save or backup fails, stop project mutations; proposed names and inventory remain useful read-only work. Do not call a stale disk copy a backup of current edits.

Use these operations with their current schemas:

- `create_bin({name,parent_bin_id})`: use the observed parent node ID; the root may use the tool's documented default. Require the returned ID, parent and `verified:true`. A committed-but-unverified result requires inspection before any retry.
- `move_items_to_bin({item_ids,target_bin})`: use node IDs for both items and destination. The batch is not atomic; inspect all its items on failure, including those reportedly moved. Never move a bin into itself/its descendants, or dispatch both a parent bin and its descendants as redundant moves.
- `rename_project_item({item_id,new_name})`: use the Project-item node ID, including for sequence items. Sequence renames can also update the live sequence name. Use supported `rename_bin` only if needed and available.

Before creation, look for the exact name under the intended parent. Reuse a verified existing bin or one recorded in this run. Do not merge/delete same-named bins or invent a duplicate template bin to evade ambiguity; resolve the intended ID from context or ask. Record stable ID-to-name mappings for numbered sources and skip already verified destinations/names on an authorized resume. New bins do not count as moved media.

Treat MCP `isError`, `structuredContent.ok:false` and an unwrapped `success:false`/`ok:false` as failures. A timeout can follow a committed change. Stop writes, inspect actual state, and journal observed per-item outcomes before deciding whether a retry is necessary.

For content-based video naming, `generate_media_contact_sheet({media_path:verifiedProxyPath,output_path:freshPngPath})` reads that path with FFmpeg, independent of Premiere's proxy switch. Use new local output paths, retain the source-item ID association and actually inspect the image. Independent contact sheets can run concurrently after evidence is captured; serialize Premiere operations.

## Proportionate verification

For a bin-only task, compare tree membership, intended names/parents, sequence identities and the available media/label/proxy baseline. Read back all affected items and the complete scoped tree, and check that unrelated original parent/name mappings stayed unchanged. Any unexplained missing/additional item or changed source association stops completion. Do not require rendered previews, transcription or all-sequence effect inspections for routine bin moves.

When timeline verification is needed, use `get_full_sequence_info` with explicit sequence IDs. Snapshot video and audio separately using `track_type`, `clip_limit` and `clip_offset`, without time/track-index filters. Follow `pagination.nextOffset` with identical filters until exhausted. Require consistent sequence ID, settings and track headers across pages, unique clip IDs/indices, and merged counts equal to each `clipCount`. The last page's `truncated:false` alone is insufficient. Retain raw pages. Inspect capped markers/transitions/effects separately when relevant, or report the limit.

Compare tracks by exposed kind/index/name/count/state, not invented stable track IDs. Compare source-item links, instance IDs within the same live session, ordering, start/end, in/out, enabled state, speed and exposed edit state. Allow only planned name changes associated with exact source IDs; do not ignore all name differences. `get_sequence_structure` lacks audio enabled/speed and source-link evidence in the pinned runtime. Full inspection exposes effect names, not every effect parameter, native color, camera/channel setting or transcript. Stronger claims need their own supported evidence. After reopening, use freshly resolved identities and semantic source/timing comparisons; live instance IDs can change.

## Native acceptance checklist

Before claiming native acceptance, use a disposable saved project copy to exercise the numbered schema with nested and empty bins, duplicate names/imports, offline media, unclear audio, adjustment layers, attached and missing proxies, and a sequence referencing renamed media. Confirm preservation of labels/proxy paths and available sequence state. Rerun/resume without duplicate bins or renumbered names. Exercise a partial batch and an unknown outcome without replaying it. Confirm another writer/pending edit blocks organization and a stopped organizer blocks later edits until reconciliation. Save/close/reopen the copy and verify the structure and media evidence persist, resolving fresh IDs as needed.

Package tests and local helper tests do not establish that native acceptance. Record unperformed host/UI checks explicitly; do not close/reopen or organize a production project just to validate this skill's integration.
