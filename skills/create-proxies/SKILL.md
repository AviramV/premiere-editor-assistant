---
name: create-proxies
description: Create, validate and attach editing proxies for local video media in Adobe Premiere Pro using FFmpeg or Adobe Media Encoder. Use for standalone proxy requests or when editing or content review encounters missing proxies.
---

Resolve the plugin root two directories above this skill folder. Use the shared runtime and executable discovery from setup; keep media, logs and receipts in the project's working directory outside the installed plugin. This workflow is shared by Codex and Claude Code and does not require transcription models. Read [encoding and verification](references/encoding.md) for the selected backend.

## Choice and defaults

Inspect the scoped source items, attached proxy paths and file availability first. Reuse available attached proxies, regardless of their format, and enable and verify Premiere's proxy toggle before footage-dependent work. Missing files behind an attachment are unavailable proxies.

When proxies are missing or unavailable, offer:

- **Create and attach proxies for me** — default 1920×1080 Apple ProRes 422 for 16:9 footage.
- **Attach existing proxies for me** — use the location the user provides.
- **I'll create or attach them manually** — wait for the user to report readiness, then verify.
- **Use originals for this task** — proceed only when the user explicitly chooses this exception.

A request to create proxies already authorizes encoding, validation, attachment to the intended project items, enabling proxy playback and saving; do not ask again for the same decision. Honor any narrower request, such as files only. Before that decision, continue independent script, inventory and connection preparation; footage review and editing wait. Do not regenerate available attached proxies to match the new default. A missing attachment's path must be reconciled before authorized reattachment or replacement.

Default new 16:9 proxies to QuickTime MOV, **1920×1080, Apple ProRes 422 standard, 10-bit 4:2:2**. ProRes 422 Proxy, LT and HQ are different profiles; do not substitute them. Preserve source frame timing, duration, aspect ratio, orientation, timecode, color interpretation and Premiere-recognized audio stream/channel layout. Match each source's frame rate, including mixed-rate bins; do not force 24/25/30 fps. Do not stretch non-16:9 media, upscale smaller sources, bake a LUT/tone map, normalize audio or change source interpretation to meet a default. Resolve a suitable size for other aspect ratios from the task context and report it. Explicit user settings override defaults.

Honor the chosen destination. Otherwise use the established project proxy folder or a project-local Proxies folder with source-relative subfolders to avoid basename collisions. State the destination and backend, check capacity and write access, and preserve originals. Do not put outputs in the plugin/runtime store. New outputs use collision-free `_Proxy.mov` names and separate partial paths; never overwrite an existing or uncertain file.

## Backend

Honor an explicit encoder choice. Otherwise prefer **FFmpeg with a verified VideoToolbox ProRes encoder on a supported Mac**, after a representative pilot passes. Encoder discovery alone does not prove hardware works. Use `prores_videotoolbox`, standard profile 2; keep software fallback disabled when measuring hardware. If hardware is unavailable, report that and choose supported `prores_ks` profile 2 or Media Encoder based on source support and the task.

Prefer **Premiere Create Proxies → Media Encoder** for Adobe-specific importers, complex camera/audio interpretation or an established Adobe ingest preset. The native UI can auto-attach completed proxies; the bridge's `manage_proxies(action:"create")` is only an AME handoff and needs explicit verification and attachment. Do not infer either route from the app being open.

## Prepare, encode and attach

1. Inventory every scoped source by stable item ID and exact original path, or by path for a files-only request. Record source metadata, any attachment, frame timing, audio layout, requested output path and backend. Inspect originals only as needed to prepare/validate proxies; this authorization does not start editorial performance review.
2. Before native writes, reuse the project's existing shared writer lock and execution journal. Use `PremiereCoordinator` from `workflow/src/premiere/coordinator.mjs` with the exact observed project path and existing journal directory. Under its lock, inspect `ledger()`, stop for `dispatched`, `indeterminate` or `ui_pending` entries, and persist each intention/readback with `persist()`. Save and verify a current project backup before attachment or other project changes. Do not create another journal to bypass a lock. A files-only encode needs no Premiere connection or project writes.
3. Encode and validate a representative pilot for each distinct resolution/rate, rotation, color and audio-layout group before batching. Start with bounded concurrency; two hardware jobs are a reasonable initial choice when resources permit. Preserve complete logs. Check each output before promoting its partial file to the final name. Existing partials require reconciliation; a process failure never establishes a usable proxy.
4. Recheck project identity, source IDs and original paths under the shared writer lock before attachment. Reuse a matching verified attachment. For each missing authorized attachment, journal the exact source-to-proxy mapping, call `manage_proxies` with `action:"attach"`, and read back the actual attached path and availability. Never attach by basename alone or replace the original media link. An unexpected existing attachment stops that item's mutation for reconciliation.
5. Read proxy playback state; explicitly enable it when OFF, then read back ON. Prefer an explicit setter if available; a blind toggle can disable playback. Save and verify every scoped item's mapping, originals and source interpretation remain intact. Confirm persistence from saved native project evidence; use a disposable project copy when close/reopen acceptance is needed. Do not close another active editing session to test proxy attachment.
6. Return created/reused/attached/failed counts, destination, actual codec/size/backend, proxy playback state, elapsed time and any unverified checks. A queued job, file's name, successful exit or attachment flag alone is not completion. Pass verified proxy paths directly to external review tools; Premiere's toggle does not redirect FFmpeg or contact-sheet inputs.

After a timeout or uncertain native result, inspect the original journal, current attachment and file before any retry. Keep the uncertain evidence; do not replay an encode, attachment or toggle blindly. Follow [host recovery](../setup/references/host-recovery.md) for connection failures.

Record batch wall time separately from summed concurrent per-file time, source duration, encode/validation/attachment time and any retries or reused outputs. Compare backends only with the same source set, settings, hardware, storage/cache conditions and concurrency. Historical runs with different footage or profiles cannot establish an AME-versus-FFmpeg speed winner.
