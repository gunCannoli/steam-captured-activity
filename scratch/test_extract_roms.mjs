import fs from 'fs';

const buf = fs.readFileSync('C:/game/steam/userdata/83513586/config/shortcuts.vdf');

function parseVdf(b) {
    let offset = 0;
    function readString() {
        let start = offset;
        while (offset < b.length && b[offset] !== 0) offset++;
        const s = b.toString('utf8', start, offset);
        offset++;
        return s;
    }
    const entries = [];
    if (b[offset++] !== 0) return [];
    readString();
    while (offset < b.length) {
        const type = b[offset++];
        if (type === 8) break;
        if (type === 0) {
            readString();
            const entry = {};
            while (offset < b.length) {
                const subType = b[offset++];
                if (subType === 8) break;
                const key = readString().toLowerCase();
                if (subType === 1) entry[key] = readString();
                else if (subType === 2) { entry[key] = b.readInt32LE(offset) >>> 0; offset += 4; }
                else if (subType === 0) { readString(); while (offset < b.length && b[offset++] !== 8) {} }
            }
            entries.push(entry);
        }
    }
    return entries;
}

function extractRom(cmd, launch) {
    const full = (cmd || '') + ' ' + (launch || '');
    const quoted = [...full.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    for (let i = quoted.length - 1; i >= 0; i--) {
        const q = quoted[i].toLowerCase();
        if (!q.includes('retroarch.exe') && !q.includes('_libretro.dll') && !q.startsWith('-')) {
            return quoted[i];
        }
    }
    const tokens = full.trim().split(/\s+/);
    return tokens[tokens.length - 1];
}

const entries = parseVdf(buf);
const ra = entries.filter(e => (e.exe || '').toLowerCase().includes('retroarch'));
let extractedCount = 0;
const missing = [];
for (const e of ra) {
    const rom = extractRom(e.exe, e.launchoptions);
    if (rom && fs.existsSync(rom)) extractedCount++;
    else missing.push({ name: e.appname, rom });
}
console.log(`Total RetroArch: ${ra.length}, Successfully resolved & exists on disk: ${extractedCount}`);
const extMap = {};
for (const e of ra) {
    const rom = extractRom(e.exe, e.launchoptions);
    if (rom) {
        const ext = rom.split('.').pop().toLowerCase();
        extMap[ext] = (extMap[ext] || 0) + 1;
    }
}
console.log('ROM extensions breakdown:', extMap);

