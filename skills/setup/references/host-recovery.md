# Recover Premiere work with minimal interruption

Keep Premiere running during normal editing. A timeout, disconnected bridge or expired script object does not by itself establish that Premiere needs restarting. Historical restarts between large reorder checkpoints are evidence of a limitation in a particular run, not a routine recovery procedure or a fixed clip-count restart threshold.

## Diagnose before changing connections

1. Stop further writes to the affected project. Preserve the execution journal, exact operation ID, error, project path and sequence ID. A timeout can leave an operation running or partly committed. Do not replay it, change its ID, clear its journal/lock or start a replacement delivery to bypass uncertainty.
2. Check whether Premiere is busy with a modal dialog, export, save or an outstanding edit. Allow active work to finish; do not reload a panel or close the project while an operation could still be running. Use bounded read-only checks when the host can answer.
3. Probe the affected bridge independently. A responding CEP bridge does not prove UXP is healthy, or vice versa. When both respond, inspect the exact target and reconcile actual state with the journal. Do not restart a healthy host to clear an editorial mismatch, unsupported operation, missing permissions, wrong target, missing proxy or incomplete transcript.

## Recover the smallest affected component

For a connection failure with no operation in flight, reconnect the affected agent MCP connection and verify it. If its Premiere panel is disconnected, reopen that panel and probe again. Use the installation-specific panel reload mechanism when needed. Avoid reinstalling or launching duplicate bridges as a connection repair. A change to the agent's startup configuration concerns its connections, not a Premiere application restart.

For expired native objects, reacquire the project, sequence, tracks and clips from the live host. The guarded reorder refreshes its project/sequence/track chain for each bounded readback attempt and reads final duration through a fresh sequence. These retries are read-only; failed clone, removal and shift mutations are never automatically repeated. Persistent failure leaves the operation uncertain for reconciliation.

Use `recover-parked-reorder` only when its exact saved/native evidence proves the complete parked result. It removes the verified empty lead-in without replaying cloning. It is not a general recovery command for partially cloned batches. A checkpoint number alone does not authorize resumption. Preserve partial results for exact reconciliation; do not schedule repeated application restarts to advance checkpoints.

If reconnecting the affected component is insufficient, and all work has stopped with a verified save, close and reopen the affected project and verify its identity, sequence and journal state. Save/close/reopen persistence acceptance means reopening the project; it does not require quitting Premiere. Consolidate persistence checks at delivery milestones instead of reopening after each clip or batch.

## Application restart as a last resort

Consider a normal application restart only when a persistent host-level failure remains after applicable component/project recovery, or an actual panel installation explicitly requires it. Before initiating it, explain the evidence and record a restart entry in the project's working directory (for example `host-recovery.jsonl`): timestamp, host version, project/sequence and operation IDs, original error, probe results, recovery steps and outcomes, whether operations have stopped, save/backup status, and the reason a full restart is necessary. Record unavailable evidence as unavailable; never invent a successful save. Do not force-quit to bypass an uncertain edit or save.

After recovery, verify the exact project and sequence, both required bridges, proxy availability and playback setting, and reconcile the journal before resuming writes. A restart never resolves an indeterminate journal entry by itself. Report live verification separately from automated tests; zero-restart large-reorder reliability requires native acceptance.
