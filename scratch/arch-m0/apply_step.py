"""Migration plan steps M3.1+: check or apply one packaged step.

Usage, from C:\\game\\millennium\\steam-cartridges:
    python ../scratch/arch-m0/apply_step.py <step> check
    python ../scratch/arch-m0/apply_step.py <step> apply
    python ../scratch/arch-m0/apply_step.py <step> paths   (the paths to stage)
e.g. <step> = m3.1

Reads scratch/arch-m0/<step>/manifest.json (written by pack_step.py):
  edited:  path -> sha256 prefix of the file before the step (LF-normalized)
  deleted: path -> sha256 prefix of the file before the step
  new:     paths that must not exist yet
The new content of edited and new files is in <step>/files/<path>. Every line says ok,
or STALE (the tree is not what the architect dry-ran against; nothing is written).
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def digest(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()[:16]


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in ("check", "apply", "paths"):
        print(__doc__)
        return 2
    step, mode = sys.argv[1], sys.argv[2]
    base = os.path.join(HERE, step)
    with open(os.path.join(base, "manifest.json"), encoding="utf8") as f:
        man = json.load(f)
    if mode == "paths":
        # One path per line, for `git add -- $(python ... <step> paths)` (commit, § 0.7).
        print("\n".join(sorted([*man["edited"], *man["deleted"], *man["new"]])))
        return 0
    root = "."
    lines, stale = [], False
    for kind, table in (("EDIT", man["edited"]), ("DELETE", man["deleted"])):
        for rel, want in sorted(table.items()):
            p = os.path.join(root, rel)
            if not os.path.isfile(p):
                lines.append(f"{kind} {rel}: STALE (missing)")
                stale = True
            elif digest(p) != want:
                lines.append(f"{kind} {rel}: STALE (content differs from the dry-run base)")
                stale = True
            else:
                lines.append(f"{kind} {rel}: ok")
    for rel in sorted(man["new"]):
        if os.path.exists(os.path.join(root, rel)):
            lines.append(f"NEW {rel}: STALE (already exists)")
            stale = True
        else:
            lines.append(f"NEW {rel}: ok")
    if mode == "apply" and not stale:
        for rel in list(man["edited"]) + list(man["new"]):
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            with open(os.path.join(base, "files", rel), "rb") as f:
                data = f.read().replace(b"\r\n", b"\n")
            with open(dst, "wb") as f:
                f.write(data)
        for rel in man["deleted"]:
            os.remove(os.path.join(root, rel))
            d = os.path.dirname(os.path.join(root, rel))
            while d and d != root and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
    print("\n".join(lines))
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
