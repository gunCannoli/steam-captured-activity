// The layer rule (docs/steam-captured-activity.md § 2): only surfaces write to Steam. Sensors, the app layer, domain
// and kernel never import a surface; domain, kernel and app never import Steam bindings, so they stay pure.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "frontend");

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
}

function layer(path: string): string {
    const rel = relative(ROOT, path).split(sep);
    return rel.length === 1 ? "root" : rel[0]!;
}

function importsOf(path: string): string[] {
    return [...readFileSync(path, "utf8").matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]!);
}

const FORBIDDEN: Record<string, string[]> = {
    kernel: ["surfaces", "steam", "sensors", "app", "settings"],
    domain: ["surfaces", "steam", "sensors", "app", "settings"],
    app: ["surfaces", "steam", "sensors", "settings"],
    sensors: ["surfaces", "app", "settings"],
    surfaces: ["sensors", "app", "settings"],
    settings: ["surfaces", "sensors", "app", "steam"],
};

test("architecture: no layer imports one it may not", () => {
    const bad: string[] = [];
    for (const file of files(ROOT)) {
        const from = layer(file);
        for (const spec of importsOf(file)) {
            if (!spec.startsWith(".")) continue;
            const target = layer(join(file, "..", spec));
            if (FORBIDDEN[from]?.includes(target)) bad.push(`${relative(ROOT, file)} -> ${spec}`);
        }
    }
    assert.deepEqual(bad, []);
});

test("architecture: the pure layers import no package (they run under node in these tests)", () => {
    const bad: string[] = [];
    for (const file of files(ROOT)) {
        if (!["kernel", "domain", "app"].includes(layer(file)) && !file.endsWith("view-core.ts")) continue;
        for (const spec of importsOf(file)) if (!spec.startsWith(".")) bad.push(`${relative(ROOT, file)} -> ${spec}`);
    }
    assert.deepEqual(bad, []);
});
