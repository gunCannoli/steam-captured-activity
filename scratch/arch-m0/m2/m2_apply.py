"""Migration plan step M2 (sensors): check or apply the dry-run files.

Usage, from C:\\game\\millennium\\steam-cartridges:
    python ../scratch/arch-m0/m2/m2_apply.py . check
    python ../scratch/arch-m0/m2/m2_apply.py . apply

Every edited file must still be exactly what the architect dry-ran against (sha256 of
its LF-normalized text, first 16 hex chars); every new file must not exist yet.
Otherwise the line says STALE and nothing is written. The full diff is m2.diff.
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "files")

# Edited files: path -> sha256 prefix of the pre-M2 file (tree at 915cb1a).
EDITED = {
    "frontend/features/buckets/collections.ts": "c8df362d4fe7cd7d",
    "frontend/features/buckets/ready.ts": "eeecf0f44428f0f8",
    "frontend/features/source-view.ts": "ec9e07556e6eda56",
    "frontend/index.tsx": "04582168d59172f4",
    "tests/architecture-allowlist.json": "356ffb65c25040f1",
    "tests/architecture.test.ts": "6d127830bed26dc8",
    "tests/buckets-ready.test.ts": "161fd8d41514bc1e",
}
NEW = [
    "frontend/app/bus.ts",
    "frontend/sensors/view/core.ts",
    "frontend/sensors/view/index.ts",
    "frontend/sensors/lifecycle/index.ts",
    "frontend/sensors/collections/index.ts",
    "tests/sensors.test.ts",
]


def digest(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()[:16]


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in ("check", "apply"):
        print(__doc__)
        return 2
    root, mode = sys.argv[1], sys.argv[2]
    lines, stale = [], False
    for rel, want in EDITED.items():
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            lines.append(f"EDIT {rel}: STALE (missing)")
            stale = True
        elif digest(p) != want:
            lines.append(f"EDIT {rel}: STALE (content differs from the dry-run base)")
            stale = True
        else:
            lines.append(f"EDIT {rel}: ok")
    for rel in NEW:
        p = os.path.join(root, rel)
        if os.path.exists(p):
            lines.append(f"NEW {rel}: STALE (already exists)")
            stale = True
        else:
            lines.append(f"NEW {rel}: ok")
    if mode == "apply" and not stale:
        for rel in list(EDITED) + NEW:
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(os.path.join(SRC, rel), "rb") as f:
                data = f.read().replace(b"\r\n", b"\n")
            with open(dst, "wb") as f:
                f.write(data)
    print("\n".join(lines))
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
