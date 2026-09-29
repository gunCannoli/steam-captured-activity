"""Architect tool: package one dry-run step for apply_step.py.

Usage (in the dry-run worktree, after committing the step there):
    python pack_step.py <worktree>/steam-cartridges <base-ref> <head-ref> <out-dir>
Writes <out-dir>/manifest.json, <out-dir>/files/..., <out-dir>/<step>.diff.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True).stdout


def digest(data):
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()[:16]


def main():
    root, base, head, out = sys.argv[1:5]
    step = os.path.basename(os.path.normpath(out))
    if os.path.isdir(os.path.join(out, "files")):
        shutil.rmtree(os.path.join(out, "files"))
    os.makedirs(out, exist_ok=True)
    status = git(root, "diff", "--name-status", "--no-renames", base, head, "--", ".").decode().split("\n")
    man = {"edited": {}, "deleted": {}, "new": []}
    for line in filter(None, status):
        code, path = line.split("\t")
        rel = path.split("steam-cartridges/", 1)[1] if path.startswith("steam-cartridges/") else path
        if code in ("M", "D"):
            before = git(root, "show", f"{base}:./{rel}")
            man["edited" if code == "M" else "deleted"][rel] = digest(before)
        elif code == "A":
            man["new"].append(rel)
        else:
            raise SystemExit(f"unexpected status {code} for {path}")
        if code in ("M", "A"):
            dst = os.path.join(out, "files", rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(git(root, "show", f"{head}:./{rel}").replace(b"\r\n", b"\n"))
    man["new"].sort()
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf8", newline="\n") as f:
        json.dump(man, f, indent=2, sort_keys=True)
        f.write("\n")
    with open(os.path.join(out, f"{step}.diff"), "wb") as f:
        f.write(git(root, "diff", base, head, "--", "."))
    print(json.dumps({k: len(v) for k, v in man.items()}))


if __name__ == "__main__":
    main()
