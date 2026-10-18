#!/usr/bin/env python3
"""Read-only OMF delivery checks. JSON output; nonzero exit on failed evidence."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import struct
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def count(value):
    return type(value) is int and value >= 0


def snapshot(path, kind):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    require(isinstance(data, dict), "Expected an unwrapped sequence data object")
    require(isinstance(data.get("id"), str) and bool(data["id"]), "Missing sequence identity")
    tracks = data.get(kind + "Tracks")
    require(isinstance(tracks, list), "Missing track evidence")
    total = data.get(kind + "TrackCount")
    require(count(total) and len(tracks) == total, "Incomplete track collection")
    require([t.get("index") for t in tracks if isinstance(t, dict)] == list(range(total)),
            "Missing, duplicate or unordered track indices")
    page = data.get("pagination", {})
    require(isinstance(page, dict) and page.get("truncated") is False and
            "nextOffset" in page and page["nextOffset"] is None and page.get("offset") == 0,
            "Snapshot pagination is incomplete or unknown")
    seen = set()
    for track in tracks:
        require(isinstance(track.get("clips"), list), "Missing clip evidence")
        require(count(track.get("clipCount")) and len(track["clips"]) == track["clipCount"],
                "Incomplete track clips")
        require([c.get("index") for c in track["clips"] if isinstance(c, dict)] ==
                list(range(track["clipCount"])), "Missing, duplicate or unordered clip indices")
        require(isinstance(track.get("transitions"), list), "Missing transition evidence")
        require(track.get("transitionsTruncated") is False, "Incomplete transitions")
        require(count(track.get("transitionCount")) and
                len(track["transitions"]) == track["transitionCount"], "Transition count mismatch")
        for transition in track["transitions"]:
            require(isinstance(transition, dict) and number(transition.get("startSeconds")) and
                    number(transition.get("endSeconds")) and
                    transition["endSeconds"] >= transition["startSeconds"],
                    "Missing or invalid transition geometry")
        for clip in track["clips"]:
            node = clip.get("nodeId")
            require(isinstance(node, str) and bool(node) and node not in seen,
                    "Missing or duplicate timeline clip identity")
            seen.add(node)
            require(clip.get("effectsTruncated") is False, "Incomplete effects")
            require(isinstance(clip.get("effects"), list) and
                    count(clip.get("effectCount")) and
                    len(clip["effects"]) == clip["effectCount"], "Effect count mismatch")
    require(count(page.get("returned")) and
            page["returned"] == sum(t["clipCount"] for t in tracks),
            "Pagination returned count does not cover this track kind")
    return data


def normalize(value):
    if isinstance(value, float):
        require(math.isfinite(value), "Non-finite numeric evidence")
        return round(value, 9)
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    return value


def audio_signature(data, retain):
    result = []
    timing = ("startSeconds", "endSeconds", "durationSeconds", "inPointSeconds", "outPointSeconds", "speed")
    required = ("sourceNodeId", "sourceMediaPath", "enabled", "effects") + timing
    for track in data["audioTracks"]:
        require(type(track.get("isMuted")) is bool, "Missing track mute state")
        clips = []
        for clip in track["clips"]:
            require(all(k in clip for k in required), "Missing audio identity/geometry evidence")
            require(clip["enabled"] is True or clip["enabled"] is False, "Unknown clip enabled state")
            require(isinstance(clip["sourceNodeId"], str) and bool(clip["sourceNodeId"]),
                    "Missing stable audio source identity")
            require(isinstance(clip["sourceMediaPath"], str), "Missing audio source path evidence")
            require(all(number(clip[k]) for k in timing) and
                    clip["endSeconds"] > clip["startSeconds"] and clip["durationSeconds"] > 0 and
                    clip["outPointSeconds"] > clip["inPointSeconds"] and clip["speed"] > 0,
                    "Invalid audio geometry or speed")
            if retain and clip["enabled"] is False:
                continue
            # Ignore only top-level collection/UI identities; nested effect or
            # channel indices, when exposed, must remain part of the comparison.
            clips.append(normalize({k: v for k, v in clip.items()
                                    if k not in ("nodeId", "index", "isSelected")}))
        transitions = [normalize({k: v for k, v in t.items() if k != "index"})
                       for t in track["transitions"]]
        if clips or transitions:
            require(not retain or track["isMuted"] is False,
                    "Muted track: resolve inclusion explicitly and compare an approved expectation")
            # Only collection identities and UI/lock state are ignored. Future
            # exposed audio settings remain part of the comparison.
            settings = {k: normalize(v) for k, v in track.items() if k not in
                        ("index", "name", "clips", "clipCount", "transitions",
                         "transitionCount", "transitionsTruncated", "isLocked", "isTargeted")}
            result.append({"settings": settings, "clips": clips, "transitions": transitions})
    return result


def check_audio(before, after, mode):
    left = snapshot(before, "audio")
    right = snapshot(after, "audio")
    a = audio_signature(left, mode == "retained")
    b = audio_signature(right, False)
    require(any(t["clips"] for t in b), "No retained audio clips for sound delivery")
    require(a == b, "Retained audio metadata differs; inspect clip/track/transition snapshots")
    for key in ("zeroPoint", "frameRate", "audioSampleRateHz", "audioChannelType", "audioChannelCount"):
        require(left.get(key) is not None and right.get(key) is not None, "Missing sequence setting: " + key)
        require(normalize(left[key]) == normalize(right[key]), "Changed sequence setting: " + key)
    for data in (left, right):
        require(number(data["zeroPoint"]), "Invalid sequence zero point")
        require(isinstance(data["frameRate"], dict) and number(data["frameRate"].get("seconds")) and
                data["frameRate"]["seconds"] > 0, "Invalid sequence frame duration")
        require(number(data["audioSampleRateHz"]) and data["audioSampleRateHz"] > 0 and
                count(data["audioChannelType"]) and count(data["audioChannelCount"]) and
                data["audioChannelCount"] > 0, "Invalid sequence audio settings")
    return {"ok": True, "mode": mode, "beforeId": left["id"], "afterId": right["id"], "tracks": len(b),
            "clips": sum(len(t["clips"]) for t in b),
            "scope": "Exposed audio metadata only; not effect parameters or listening verification"}


def check_video(path):
    data = snapshot(path, "video")
    count = sum(len(t["clips"]) for t in data["videoTracks"])
    require(count == 0, "Video/graphics clips remain: " + str(count))
    require(all(not t["transitions"] for t in data["videoTracks"]), "Video transitions remain")
    return {"ok": True, "videoClips": 0, "emptyVideoTracks": len(data["videoTracks"])}


def check_file(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "Expected a regular delivery file")
        size = stream.seek(0, 2)
        require(size > 24, "File too small for Bento footer")
        stream.seek(-24, 2)
        magic, flags, block, major, minor, offset, length = struct.unpack("<8sHHHHII", stream.read(24))
        require(magic == bytes.fromhex("a4434da5486472d7"), "Bento footer absent or unsupported")
        require(length > 0 and offset < size - 24 and offset + length <= size - 24,
                "Invalid Bento table-of-contents bounds")
        stream.seek(0)
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
        current = path.stat()
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(stream.tell() == size and signature(before) == signature(after) == signature(current),
                "File changed while checking")
    return {"ok": True, "path": str(path.resolve()), "bytes": size,
            "sha256": digest.hexdigest(), "bentoVersion": [major, minor],
            "scope": "Bento bounds only; OMF objects, audio, export settings and DAW import not checked"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("audio")
    p.add_argument("before")
    p.add_argument("after")
    p.add_argument("--mode", choices=("retained", "unchanged"), default="retained")
    sub.add_parser("video").add_argument("snapshot")
    sub.add_parser("file").add_argument("path")
    args = parser.parse_args()
    try:
        if args.command == "audio":
            result = check_audio(args.before, args.after, args.mode)
        elif args.command == "video":
            result = check_video(args.snapshot)
        else:
            result = check_file(args.path)
    except (ValueError, OSError, KeyError, TypeError, struct.error) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
