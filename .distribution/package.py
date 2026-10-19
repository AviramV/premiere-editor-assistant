#!/usr/bin/env python3
"""Validate the released payload and optionally reproduce its ZIP."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / '.distribution/payload.json').read_text())
expected = manifest['files']
actual = set()
for top in sorted({Path(name).parts[0] for name in expected}):
    entry = ROOT / top
    for item in ([entry] if entry.is_file() else entry.rglob('*')):
        if item.is_symlink():
            raise SystemExit('Symlink forbidden: ' + str(item.relative_to(ROOT)))
        if item.is_file():
            actual.add(item.relative_to(ROOT).as_posix())
if actual != set(expected):
    raise SystemExit('Payload file set differs: ' + repr(actual.symmetric_difference(expected)))
node = os.environ.get('PREMIERE_ASSISTANT_NODE') or shutil.which('node')
if not node:
    raise SystemExit('Node.js 22+ is required; add it to PATH or set PREMIERE_ASSISTANT_NODE.')
major = int(subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')[0])
if major < 22:
    raise SystemExit('Node.js 22+ required')
modules = 0
for name, checksum in expected.items():
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('Unsafe payload path: ' + name)
    item = ROOT / name
    data = item.read_bytes()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise SystemExit('Payload checksum mismatch: ' + name)
    if item.suffix == '.json':
        json.loads(data)
    if item.suffix in ('.mjs', '.cjs'):
        subprocess.run([node, '--check', str(item)], check=True)
        modules += 1
plugin = json.loads((ROOT / 'plugin.json').read_text())
compat = json.loads((ROOT / '.codex-plugin/plugin.json').read_text())
assert plugin['name'] == compat['name'] == manifest['name']
assert plugin['version'] == compat['version'] == manifest['version']
catalog = json.loads((ROOT / '.agents/plugins/marketplace.json').read_text())
assert len(catalog['plugins']) == 1
assert catalog['plugins'][0]['name'] == plugin['name']
assert (ROOT / catalog['plugins'][0]['source']['path']).resolve() == ROOT
for name in ['scripts/launch.sh', 'scripts/setup.mjs', 'scripts/bridge.mjs',
             'skills/setup/SKILL.md', 'skills/edit-video/SKILL.md',
             'workflow/tools/workflow.mjs', 'vendor/leancoder/LICENSE']:
    assert name in expected, name
print('Validated %d payload files and %d JavaScript modules.' % (len(expected), modules))
if '--build' in sys.argv:
    destination = ROOT / 'dist'
    destination.mkdir(exist_ok=True)
    archive = destination / ('%s-%s.zip' % (plugin['name'], plugin['version']))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for name in sorted(expected):
            entry = zipfile.ZipInfo(plugin['name'] + '/' + name, (1980, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, (ROOT / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    if checksum != manifest['originalArchiveSha256']:
        raise SystemExit('Rebuilt archive differs from the tested source artifact')
    archive.with_suffix('.zip.sha256').write_text(checksum + '  ' + archive.name + '\n')
    with zipfile.ZipFile(archive) as output:
        assert output.testzip() is None
    print('Built %s (%s)' % (archive.name, checksum))
