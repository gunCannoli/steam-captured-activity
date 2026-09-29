// Pure helper of the Troubleshooting panel (migration plan M8d): edit the `disabledFeatures` setting string.
// Keeps unknown ids the user typed, keeps the order of `featureIds`, never duplicates.

function parse(raw: string): string[] {
    return String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** `on` = the feature runs (its id is removed from the disabled list); off adds it. */
export function toggleFeature(raw: string, id: string, on: boolean, featureIds: readonly string[] = []): string {
    const disabled = new Set(parse(raw));
    if (on) disabled.delete(id);
    else disabled.add(id);
    const known = featureIds.filter((f) => disabled.has(f));
    const unknown = [...disabled].filter((f) => !featureIds.includes(f));
    return [...known, ...unknown].join(',');
}
