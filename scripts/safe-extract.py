import pathlib, stat, sys, zipfile
archive, destination, strip = sys.argv[1:]
root = pathlib.Path(destination).resolve()
with zipfile.ZipFile(archive) as z:
    members = []
    for item in z.infolist():
        name = item.filename
        p = pathlib.PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or '\\' in name or stat.S_ISLNK(item.external_attr >> 16):
            raise SystemExit('Unsafe archive member: ' + name)
        parts = p.parts[int(strip):]
        if not parts: continue
        out = root.joinpath(*parts)
        if not out.is_relative_to(root): raise SystemExit('Archive escapes destination')
        members.append((item, out))
    for item, out in members:
        if item.is_dir(): out.mkdir(parents=True, exist_ok=True)
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(z.read(item))
