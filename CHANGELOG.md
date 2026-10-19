# Changelog

## 0.1.3

Automated Plugin Publishing is now maintained from a private development source with versioned, reproducible public distribution.

- Validate tests and packaging on feature branches and pull requests.
- Publish newer versions after they reach main, using a distribution-repository-only GitHub App token.
- Import the tested artifact, record source provenance, reproduce the ZIP, and verify uploaded assets before publishing the release.
- Preserve existing releases and support retries of matching interrupted publications.
- Add development commands for synchronized version preparation and verified local plugin updates.

This release changes distribution tooling and version metadata. Native transcript and editing behavior retain the acceptance evidence from 0.1.2. CI tests do not establish new Premiere host, listening, OMF export or target-DAW acceptance.

## 0.1.2

Premiere Editor Assistant 0.1.2 keeps external transcripts available inside Premiere for later native caption creation.

- Import timed words after external transcription, including cache reuse, onto the exact original media item through the fixed UXP bridge.
- Verify native words/timings and save; reuse matching transcripts, refuse conflicts, and quarantine uncertain responses in the shared journal.
- Preserve source clocks through edits. Premiere-created transcripts are verified and reused without reimport.
- Include the live-tested native ProjectItem identity fix, updated setup fingerprints, doctor checks and bridge discovery.
- Exclude Finder metadata from packages so GitHub installations and release ZIPs contain matching files.

Validation: 158 automated tests; three skills and both portable manifests validated; reproducible 94-file package. Live Premiere 26.3.2 testing imported 54 timed words, verified save/reopen, correctly rebased 26 words after an edit, rejected a conflict and created native captions through Premiere’s UI.

Upgrade: run setup for the 0.1.2 runtime and use the updated UXP panel. Existing transcription configurations require the Premiere project path, observed UXP source-item ID and shared journal directory. Preserve previous runtime data and project journals. Caption generation/styling remains a separate finishing action. Actual multicam/nested delivery transcript coverage, another Mac and native OMF export/DAW import require separate verification.

## 0.1.1

Combines Selects derived from prepared Takes with a separate OMF sound-handoff workflow.

- Build and prepare Takes first, then duplicate it to derive Selects by removing alternative performances and trimming reviewed boundaries. Retain native colors, camera choices, channel groups, source clocks and effect/keyframe state without another reorder or color pass.
- Require fresh saved-project evidence for prepared Takes, verify inherited Selects state, and preserve both Takes and the original source. A chosen interval outside usable Takes stops delivery for reconciliation.
- Add the export-omf skill using the existing CEP bridge and a standard-library Python verifier. Prepare an audio-only working copy, retain intended enabled audio, remove video without ripple or linked-audio removal, and export to a fresh staging path.
- Default to 48 kHz, 24-bit embedded WAV with five-second handles and pan information. Respect explicit delivery requirements, existing proxy policy and original-audio provenance. Document size, nesting, output-state and effect/automation limits.
- Strengthen audio evidence and container sanity checks, preserve raw observations and previous deliveries, and distinguish unverified export receipts from completed delivery.

Validated in the workflow development repository with 148 automated tests and all three skill definitions. Reproducible package relocation includes the OMF helper. The distribution contains the same 92-file payload as the validated development archive; `.distribution/payload.json` records its source commit and file hashes.

Saved native Selects inheritance has acceptance evidence in workflow development. Automated OMF tests use synthetic snapshots and container bytes: native OMF export, listening, effect fidelity and target-DAW import remain separate acceptance. The original host/setup limitations below continue to apply.

## 0.1.0

Initial shareable macOS release of the completed Premiere editorial workflow.

- Setup and editing skills with portable and Codex compatibility manifests.
- Pinned CEP/UXP bridge provisioning, guided panel installation, and live connection checks.
- Usable Takes and complete Selects, matching part colors, main-voice transcription policy, word-boundary handling, and proxy consent checks.
- Guarded editing and recovery tools, with project data stored outside the plugin.
- Optional local transcription and semantic matching dependencies.

Validated in the source repository with 131 automated tests, skill and manifest validation, reproducible packaging, clean-folder setup, and read-only live connection checks on the original Mac with Premiere 26.3.2. Different-machine installation and full native editing acceptance with freshly installed Adobe panels have not been verified. Gemini and later finishing features remain deferred.

The GitHub distribution contains the same 86-file plugin payload as the original validated archive, plus repository documentation and packaging verification tools.
