# Premiere Editor Assistant

A local Codex plugin for Adobe Premiere Pro on macOS. It creates two editable sequences: **Takes**, containing usable takes and attempts, and **Selects**, containing the selected takes. Both include every independent part, put hooks first, and use matching colors for the same parts.

## Install from GitHub

This repository is private. Your GitHub account must have access, and Git must be authenticated on your Mac. For GitHub CLI users, run `gh auth login` and `gh auth setup-git` if needed.

```sh
codex plugin marketplace add AviramV/premiere-editor-assistant
```

Open the Plugins Directory in the desktop app, choose **Premiere Editor Assistant**, and install it. Reload/restart the app if the source does not appear. Then ask:

> Set up Premiere Editor Assistant on this Mac.

The repository includes the built workflow: no development build is required. To pin the initial release, add `--ref v0.1.0` to the marketplace command.

Alternatively, download the ZIP and its SHA-256 file from [Releases](https://github.com/AviramV/premiere-editor-assistant/releases), verify with `shasum -a 256 -c premiere-editor-assistant-0.1.0.zip.sha256`, unzip it into a permanent folder, and follow [INSTALL.md](INSTALL.md).

## Requirements and setup

- macOS, local Codex desktop access, and a separately licensed Adobe Premiere Pro installation.
- Node.js 22+, Python 3.9+, FFmpeg and ffprobe.
- Internet access for the initial bridge downloads and dependency installation.
- Apple Silicon for optional local MLX Whisper transcription. Existing word transcripts are also supported. English script matching is the validated language.

The setup skill provisions pinned bridge runtimes and guides installation of the CEP and UXP panels. Open both panels in Premiere and run the live connection check before editing. See [the installation guide](INSTALL.md) for commands and configuration.

## Editorial behavior

- Include all recognized independent parts, including on-topic wording variations.
- Trim leading silence and restarts; preserve whole words and add 3–5 trailing frames where safe.
- Identify the closest main voice microphone, assess recorder channels first, and mute unsuitable tracks. Transcribe the main voice track.
- When proxies are attached and available, use them and verify Premiere’s proxy toggle is on. If proxies are missing, ask whether the user will attach them or wants assistance with a provided location.
- Keep project data outside the plugin and verify edits against the current Premiere state.

See [the full delivery policy](skills/edit-video/references/delivery-policy.md). Footage, Premiere projects, credentials, and development history are excluded. External services are not configured automatically; Gemini integration remains deferred.

## Updates

For an unpinned installation, refresh the marketplace and follow the app’s plugin update/reload flow:

```sh
codex plugin marketplace upgrade premiere-editor-assistant-local
```

The catalog identifier remains `premiere-editor-assistant-local` for compatibility with the ZIP installation. A pinned Git ref stays pinned; change the ref to adopt a newer release.

## Verification and maintenance

This is a distribution repository. The runtime files are checked in, with SHA-256 hashes and upstream development provenance in [.distribution/payload.json](.distribution/payload.json).

```sh
python3 .distribution/package.py
python3 .distribution/package.py --build
```

Validation checks the complete payload against the manifest, parses JSON files, checks JavaScript module syntax with Node.js, and verifies the marketplace points to this plugin. Building writes a reproducible ZIP and SHA-256 file under `dist/`. New releases should import a newly validated bundle, update the payload manifest and version, run these checks, and tag the resulting commit. Do feature/fix work on separate branches, then merge completed changes into `main`.

Version 0.1.0 passed 131 tests in its development repository, clean-folder installation on the original Mac, and read-only live checks of both Premiere bridges. Premiere 26.3.2 was the tested host. A different Mac and a full repeat of native editing with newly installed panels remain unverified. See [CHANGELOG.md](CHANGELOG.md).

## Third-party components

Bundled and downloaded bridge components retain their upstream licenses. See [THIRD_PARTY.md](THIRD_PARTY.md) and [the bundled MIT license](vendor/leancoder/LICENSE).
