# Premiere Editor Assistant

A local Agent Plugins package for Adobe Premiere Pro on macOS, installable in Codex and Claude Code. It creates two editable sequences: **Takes**, containing usable takes and attempts, and **Selects**, containing the selected takes. Both include every independent part, put hooks first, and use matching colors for the same parts.

Current release: **0.1.5**. See [CHANGELOG.md](CHANGELOG.md) for release notes. The plugin supports Project-panel organization, native transcript preparation, Selects derived from Takes, and OMF sound handoff.

## Install from GitHub

This repository is public. Anyone can add its plugin marketplace; no GitHub invitation is required. Both agents use the same package, skills and Premiere bridges.

**Codex:**

```sh
codex plugin marketplace add AviramV/premiere-editor-assistant
```

Open the Plugins Directory in the desktop app, choose **Premiere Editor Assistant**, and install it. Reload/restart the app if the source does not appear.

**Claude Code:**

```sh
claude plugin marketplace add AviramV/premiere-editor-assistant
claude plugin install premiere-editor-assistant@premiere-editor-assistant-local
```

Start a new Claude Code session after installation. In either agent, ask:

> Set up Premiere Editor Assistant on this Mac.

The repository includes the built workflow: no development build is required. To pin this release in Codex, add `--ref v0.1.5` to its marketplace command.

Alternatively, download the ZIP and its SHA-256 file from [Releases](https://github.com/AviramV/premiere-editor-assistant/releases), verify with `shasum -a 256 -c premiere-editor-assistant-0.1.5.zip.sha256`, unzip it into a permanent folder, and follow [INSTALL.md](INSTALL.md).

## Requirements and setup

- macOS, local execution through Codex or Claude Code, and a separately licensed Adobe Premiere Pro installation. A cloud-only chat cannot reach Premiere on your Mac.
- Node.js 22+, Python 3.9+, FFmpeg and ffprobe.
- Internet access for the initial bridge downloads and dependency installation.
- Apple Silicon for optional local MLX Whisper transcription. Existing word transcripts are also supported. English script matching is the validated language.

The setup skill provisions pinned bridge runtimes and guides installation of the CEP and UXP panels. Open both panels in Premiere and run the live connection check before editing. See [the installation guide](INSTALL.md) for commands and configuration.

## Editorial behavior

- Include all recognized independent parts, including on-topic wording variations.
- Trim leading silence and restarts; preserve whole words and add 3–5 trailing frames where safe.
- Identify the closest main voice microphone, assess recorder channels first, and mute unsuitable tracks. Transcribe the main voice track.
- When proxies are attached and available, use them and verify Premiere’s proxy toggle is on. If proxies are missing, ask whether the user will attach them or wants assistance with a provided location.
- Import every external timed transcript onto its exact original media item, verify native words/timings and save. Reuse matching native transcripts and reconcile conflicts before continuing.
- Keep project data outside the plugin and verify edits against the current Premiere state.
- Prepare and verify Takes first, then derive Selects by duplicating Takes and removing alternatives and reviewed excess at selected boundaries. Selects inherits prepared native state without another reorder or color pass.

See [the full delivery policy](skills/edit-video/references/delivery-policy.md). Footage, Premiere projects, credentials, and development history are excluded. External services are not configured automatically; Gemini integration remains deferred.

## Native transcripts and captions

After external transcription, the workflow imports timed words into Premiere through its UXP API. Source timing, main-voice selection and matching native transcripts are preserved; conflicting transcripts are not overwritten. The Text panel and save/reopen checks verify persistence and derived-sequence coverage. Later, editors can use **Create captions from transcript** in Premiere’s native UI. Preparing the transcript is automatic; caption generation and styling remain a requested finishing phase.

Upgrading from 0.1.1 requires setup for the new runtime and the updated UXP panel. Existing transcription configurations must add the observed Premiere target described in the [workflow reference](skills/edit-video/references/workflow.md#transcription-configuration). Keep previous runtime data and all project journals.

## Project organization

Ask **organize-project** to group Project-panel items into the numbered bins from `00 SEQUENCES` through `07 MATTES` and, when requested, give unclear media items descriptive names. It preserves disk filenames and timeline edits, keeps the template hierarchy, verifies a current backup, and shares the project recovery journal and writer lock. Video-content review for naming uses attached available proxies; ordinary bin moves need no footage analysis. See [the organizer skill](skills/organize-project/SKILL.md).

## OMF sound handoff

Ask the **export-omf** skill to export your chosen Premiere sequence to a destination folder. It uses the existing CEP bridge to prepare a separate audio-only working copy and preserves the source, Takes and Selects. Defaults are 48 kHz, 24-bit embedded WAV, trimmed media with five-second handles and pan information; explicit delivery specifications override them. Transcription models are not needed.

The skill checks cleanup audio metadata and file checksums/container bounds. OMF's size, nesting, track-output and effects limitations are described in [the export procedure](skills/export-omf/references/procedure.md). These checks do not establish audio content, effect fidelity, listening quality or a successful Pro Tools import. Native OMF export and target-DAW acceptance remain unverified for this release.

## Updates

For an unpinned Codex installation, refresh the marketplace and follow the app’s plugin update/reload flow:

```sh
codex plugin marketplace upgrade premiere-editor-assistant-local
```

For Claude Code:

```sh
claude plugin marketplace update premiere-editor-assistant-local
claude plugin update premiere-editor-assistant@premiere-editor-assistant-local
```

Restart the agent session after updating, then follow the shared setup and bridge checks in INSTALL.md.

The catalog identifier remains `premiere-editor-assistant-local` for compatibility with the ZIP installation. A pinned Git ref stays pinned; change the ref to adopt a newer release.

## Verification and maintenance

This is a distribution repository. The runtime files are checked in, with SHA-256 hashes and upstream development provenance in [.distribution/payload.json](.distribution/payload.json).

```sh
python3 .distribution/package.py
python3 .distribution/package.py --build
```

Validation checks the complete payload against the manifest, parses JSON files, checks JavaScript module syntax with Node.js, verifies both marketplaces point to this plugin, and checks that the portable, Codex and Claude manifest identities and versions match. Building writes a reproducible ZIP and SHA-256 file under `dist/`. This tree is generated by the private development repository after its checks pass and a newer plugin version reaches main. Releases retain source-commit provenance and reproduce the tested archive byte for byte. Make changes in the development repository; do not hand-edit generated payload files here.

Version 0.1.2 passed 158 tests in its development repository; all three skills and both portable manifests validated. Live Premiere 26.3.2 acceptance imported 54 timed words, verified save/reopen persistence and cache reuse, preserved conflicts, and generated captions through the native UI. A guarded edit correctly rebased 26 retained words and preserved them after reopening. Tests used a copied mono audio fixture in a separate project. Actual multicam/nested delivery coverage, another Mac and native OMF export/DAW import remain separate checks. See [CHANGELOG.md](CHANGELOG.md).

## Third-party components

Bundled and downloaded bridge components retain their upstream licenses. See [THIRD_PARTY.md](THIRD_PARTY.md) and [the bundled MIT license](vendor/leancoder/LICENSE).
