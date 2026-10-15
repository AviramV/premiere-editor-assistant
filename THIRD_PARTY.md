# Third-party components

The bundled CEP panel comes from leancoderkavy/premiere-pro-mcp, commit b04121195deb4f20e060a6ff3458751a00836028, under MIT. Its original license is in vendor/leancoder/LICENSE.

Setup downloads the matching leancoder runtime and quadlzzz/premiere-mcp at commit deaf221cf9db15060df2294d9fe7aee1562700f4, under MIT. Archive checksums are recorded in runtime-lock.json. The runtime preserves the upstream licenses, package lock and dependency notices. The quadlzzz panel/server receive the bundled, guarded reorder patch; its host manifest is normalized for CCX installation.

Python model dependencies are optional and installed into a separate environment. Their packages and downloaded models retain their respective licenses. Adobe Premiere Pro is separately installed and licensed by each user. No Adobe application binaries, credentials, footage or project files are included.
