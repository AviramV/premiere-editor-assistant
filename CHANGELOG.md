# Changelog

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
