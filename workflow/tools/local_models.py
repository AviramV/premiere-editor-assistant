"""Check Metal before importing MLX, which can abort on an empty device list."""
import argparse
import ctypes
import platform
import sys


class MetalUnavailable(RuntimeError):
    pass


def metal_device_count():
    # Use only system C APIs: importing mlx.core to query Metal is already unsafe.
    # NSArray and CFArray are toll-free bridged. Count without accessing index 0.
    metal = ctypes.CDLL('/System/Library/Frameworks/Metal.framework/Metal')
    core = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    metal.MTLCopyAllDevices.argtypes = []
    metal.MTLCopyAllDevices.restype = ctypes.c_void_p
    core.CFArrayGetCount.argtypes = [ctypes.c_void_p]
    core.CFArrayGetCount.restype = ctypes.c_long
    core.CFRelease.argtypes = [ctypes.c_void_p]
    core.CFRelease.restype = None
    devices = metal.MTLCopyAllDevices()
    if not devices:
        return 0
    try:
        return core.CFArrayGetCount(devices)
    finally:
        core.CFRelease(devices)


def require_metal():
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise MetalUnavailable('Local MLX transcription requires native Apple Silicon Python on macOS.')
    remedy = ('Local MLX transcription cannot access a Metal GPU in this process. '
              'MLX was not imported. A sandbox or unavailable GPU may be responsible. '
              'Use a host-approved execution context with GPU access, then rerun the check; '
              'do not reinstall models or repeat the same restricted import. '
              'Premiere-native or existing timed transcripts remain available.')
    try:
        count = metal_device_count()
    except (OSError, AttributeError) as error:
        raise MetalUnavailable(remedy + ' Metal probe failed: ' + str(error)) from error
    if count < 1:
        raise MetalUnavailable(remedy)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metal-only', action='store_true')
    args = parser.parse_args()
    try:
        count = require_metal()
    except MetalUnavailable as error:
        print(str(error), file=sys.stderr)
        return 2
    if args.metal_only:
        print('Metal GPU access available: ' + str(count) + ' device(s); model imports untested')
    else:
        import mlx_whisper, torch, transformers, sentencepiece  # noqa: F401
        print('Local transcription imports passed; model weights untested')
    return 0


if __name__ == '__main__':
    sys.exit(main())
