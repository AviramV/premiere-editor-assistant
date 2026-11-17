# Proxy encoding and verification

## Inspect sources and executable support

Use configured FFmpeg/ffprobe paths from setup rather than fixed Homebrew paths. Inspect each source with `ffprobe -v error -show_streams -show_format -of json "/absolute/source.mov"`. Record coded and displayed dimensions, sample aspect ratio, rotation/display matrix, source frame timestamps/rates/count, duration/start time/timecode, pixel format, color range/primaries/transfer/matrix, and all audio streams/channel layouts recognized by Premiere. Count decoded frames or inspect timestamps when container counts are absent; two missing counts do not constitute a match.

Use `ffmpeg -hide_banner -h encoder=prores_videotoolbox` and a representative real pilot to check hardware support. The Mac encoder's `standard`/2 profile is Apple ProRes 422; profile 0 is ProRes 422 Proxy. For software, inspect `encoder=prores_ks`. Do not label `prores_ks` hardware-accelerated or infer the codec from an output extension.

## FFmpeg

For an inspected, unrotated, square-pixel, 16:9 progressive source at least 1920×1080 with one supported Premiere audio stream, the command shape is:

```sh
"/absolute/ffmpeg" -hide_banner -nostdin -n -noautorotate \
  -i "/absolute/source.mov" \
  -map 0:v:0 -map 0:a:0 -map_metadata 0 \
  -vf "scale=1920:1080:flags=lanczos,format=p210le" \
  -c:v prores_videotoolbox -profile:v 2 -allow_sw 0 \
  -fps_mode passthrough -enc_time_base:v demux \
  -c:a pcm_s24le -movflags +faststart \
  "/absolute/Proxies/source_Proxy.partial.mov"
```

This is a command shape for that source group, not a universal mapping. Build argument arrays from inspected metadata and invoke without shell interpolation. On a validated software route, replace the video encoder/filter pixel format with `prores_ks`, profile 2 and `yuv422p10le`, and omit `-allow_sw`. Hardware pixel-format support varies by build; verify the output is 10-bit 4:2:2.

Adapt from the evidence:

- For no audio, omit the audio map/codec; for multiple recognized streams, map each explicitly with its source layout, ordering, rate and offsets. Do not force `-ac 2`, choose only a transcription microphone, or downmix a recorder's channels. An auxiliary iPhone spatial/APAC stream may not be part of Premiere's recognized layout: verify that distinction with the host and record it instead of copying an unsupported stream or silently dropping recognized audio.
- Preserve known color tags using the inspected values for `-color_primaries`, `-color_trc`, `-colorspace` and `-color_range`. Do not invent Rec.709 tags for HLG/PQ or treat metadata equality as visual color verification. Preserve source timecode explicitly when present and verify it on output.
- Preserve timestamp cadence using passthrough and source time base where supported; avoid `-r` and CFR conversion. Equal frame counts, nominal fps and total duration alone cannot prove VFR alignment. Verify timestamp offsets/cadence and sample beginning, middle and end sync in Premiere.
- Rotation needs its own pilot. `-noautorotate` preserves coded pixels, but the output display matrix can still differ or be lost. Compare effective rotation modulo 360 and displayed aspect ratio. Where supported, a separate lossless remux using `-display_rotation:v:0 "<observed-degrees>" -noautorotate -i "<partial>" -map 0 -map_metadata 0 -c copy "<new-partial>"` can restore a proven matrix mismatch. Verify it again and inspect actual orientation before promotion; do not swap width/height or rotate pixels twice.
- For anamorphic, interlaced, unusual camera or unsupported color/audio media, use a verified source-specific route, often Premiere/AME, instead of applying the example. Do not change original interpretation to get an attachment accepted.

Encode to a new partial file. After process completion, validate it and promote only within the intended destination without overwriting another file. A failed/partial previous output needs source/settings reconciliation and full validation before reuse. Stop for mismatches; keep logs and failed probes.

## Adobe Media Encoder

**Native route:** Select the exact original clips in Premiere's Project panel → Proxy → Create Proxies. Use a verified QuickTime preset with 1920×1080 and Apple ProRes 422 standard for eligible 16:9 sources; preserve source timing, color, orientation and audio. Create/save a custom preset through Adobe's UI if no existing preset matches. A built-in preset named ProRes Proxy or Half does not establish this requested profile or a fixed 1080p size. Check the preset and a pilot output. Premiere dispatches encoding to AME and can auto-attach completed jobs; verify all actual associations.

**Bridge route:** Discover the currently registered schemas with `get_capabilities`, then inspect `manage_proxies`, encoder-preset discovery and queue status. Supply the exact `item_id`, `output_path` and verified `preset_path` to `manage_proxies(action:"create")`. This returns an unverified handoff, not a completed proxy or automatic attachment. The bridge's default-preset search can fall back to H.264; always supply a preset for the ProRes 422 default. Presets using a Same as Project destination can be refused because AME may encode from a scratch project; use a supported preset with an explicit output location and verify the actual resulting path. Do not bypass this check or hand-edit opaque/compressed EPR internals.

Do not start or clear unrelated AME jobs. The bridge's `start_batch:true` starts every ready job, including other work; inspect the queue first and use targeted processing where available, or get direction if unrelated jobs would be affected. Record job IDs, preset identity, handoff/start/completion timestamps, actual paths and AME logs. Poll status and file stability, then probe and validate each completed output. A success log or queue completion is still separate from validation. Attach a validated output explicitly when the chosen route did not do so.

## Validation for either route

For every source-to-proxy pair verify:

- MOV container, ProRes **Standard**/`apcn`, 10-bit 4:2:2 and the planned dimensions/display aspect.
- Complete video coverage, frame count, timestamp cadence/start offset, frame rate and duration, with tolerances derived from the source time base. No duplicated/dropped frames or cumulative drift; VFR needs timestamp comparison.
- Effective orientation, timecode where present, and color range/primaries/transfer/matrix. Check representative rendered frames in Premiere for orientation and color interpretation; metadata equality does not prove picture matching.
- Premiere-recognized audio stream count/order, channels/layout, rate, start offsets and complete duration; preserve sync and originals. Record unsupported auxiliary streams separately.
- Exact stable source identity and original path, output availability and actual attached proxy path. Verify playback ON and saved project state independently of file validation.

Resolve missing or unreliable metadata using measured evidence; never pass a check because both fields are absent. Unsupported or uncertain mappings stop that source's attachment. Report the remaining gap precisely instead of claiming native playback, listening or save/reopen from a probe.

## Choosing and timing the route

| Route | Practical advantages | Costs and checks |
| --- | --- | --- |
| FFmpeg + VideoToolbox | Scriptable, bounded parallelism, explicit paths/logs, uses Apple's hardware ProRes path when available; no AME queue/startup | Hardware/build dependent; explicit attachment; rotation, VFR, HDR and audio metadata need verification |
| FFmpeg + prores_ks | Scriptable software fallback, same profile and validation contract | CPU load; often slower than an available hardware path; explicit attachment |
| Premiere → AME | Adobe importers/presets, visible queue, native auto-attachment route | Preset setup, queue contention and startup; bridge handoff still needs completion checks and attachment |

Choose FFmpeg hardware for routine supported media after a passing pilot; prefer AME for importer/interpretation needs or an explicit user choice. This is a workflow recommendation, not a universal performance claim. Both can be hardware accelerated; an app name alone does not establish speed.

Log batch start/end wall time, total source seconds, distinct fresh/reused counts, codec/profile, encoder/build, hardware, source/output storage, concurrency, retry time and validation/attachment time. Sum of overlapping worker durations is not elapsed batch time. Reused pilot timings and repaired partials must not masquerade as fresh encodes. A fair comparison uses the same representative sources, identical output/metadata settings and comparable caches/storage; run such a benchmark only when requested, and keep it separate from an active delivery.

Primary references: [Adobe proxy workflow](https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/ingest-and-proxy-workflow.html), [Adobe proxy creation](https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/create-proxies.html), [FFmpeg ProRes documentation](https://ffmpeg.org/ffmpeg-codecs.html#ProRes) and [FFmpeg VideoToolbox encoder source](https://www.ffmpeg.org/doxygen/8.1/videotoolboxenc_8c_source.html).
