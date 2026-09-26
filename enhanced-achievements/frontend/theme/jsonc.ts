/**
 * JSONC: JSON plus `//` and `/* *\/` comments and trailing commas, the format
 * of `.jsonc` theme files (plain `.json` themes parse the same way).
 *
 * Comments and trailing commas are blanked with spaces, keeping every newline,
 * so a `JSON.parse` error position still points at the right line and column
 * of the original file. Nothing inside a string is touched (`"https://..."`).
 *
 * Pure: no imports (tests/theme.test.ts).
 */
export function stripJsonc(text: string): string {
    const out = text.split('');
    const blank = (from: number, to: number) => {
        for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    };

    let lastSignificant = -1; // index of the last non-space, non-comment char
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // UTF-8 BOM
    if (i) out[0] = ' ';
    while (i < text.length) {
        const c = text[i]!;
        if (c === '"') {
            i++;
            while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
            i++;
            lastSignificant = Math.min(i, text.length) - 1;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            const end = text.indexOf('\n', i);
            const stop = end < 0 ? text.length : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end < 0 ? text.length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        if ((c === '}' || c === ']') && lastSignificant >= 0 && out[lastSignificant] === ',') {
            out[lastSignificant] = ' '; // trailing comma
        }
        if (!/\s/.test(c)) lastSignificant = i;
        i++;
    }
    return out.join('');
}

export function parseJsonc(text: string): unknown {
    return JSON.parse(stripJsonc(text));
}
