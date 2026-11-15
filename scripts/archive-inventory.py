"""Inspect a small legacy UXP installer without extracting or executing it."""
import hashlib
import json
from pathlib import PurePosixPath
import stat
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) > 256 or sum(x.file_size for x in entries) > 32 * 1024 * 1024:
        raise ValueError('Unexpected legacy panel archive size')
    files = {}
    manifest = None
    for entry in entries:
        name = entry.filename
        parts = PurePosixPath(name).parts
        if not name or name.startswith('/') or '\\' in name or '..' in parts or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError('Unsafe legacy panel archive path')
        if entry.is_dir():
            continue
        if name in files:
            raise ValueError('Duplicate legacy panel archive path')
        data = archive.read(entry)
        files[name] = hashlib.sha256(data).hexdigest()
        if name == 'manifest.json':
            manifest = json.loads(data)
    if not manifest or manifest.get('id') != 'com.premieremcp.agent':
        raise ValueError('Unexpected legacy panel identity')
    print(json.dumps({'files': files, 'pluginId': manifest['id']}))
