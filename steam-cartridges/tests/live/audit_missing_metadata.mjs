import fs from 'fs';

function parseVdf(buffer) {
    let offset = 0;
    const entries = [];
    function readString() {
        const start = offset;
        while (offset < buffer.length && buffer[offset] !== 0) offset++;
        const str = buffer.toString('utf8', start, offset);
        offset++;
        return str;
    }
    function readInt32() {
        const val = buffer.readInt32LE(offset);
        offset += 4;
        return val;
    }
    while (offset < buffer.length) {
        const type = buffer[offset++];
        if (type === 0x08) break;
        const key = readString();
        if (type === 0x00) {
            const item = {};
            while (offset < buffer.length) {
                const itemType = buffer[offset++];
                if (itemType === 0x08) break;
                const itemKey = readString().toLowerCase();
                if (itemType === 0x01) item[itemKey] = readString();
                else if (itemType === 0x02) item[itemKey] = readInt32();
                else if (itemType === 0x00) {
                    while (offset < buffer.length) {
                        const tagType = buffer[offset++];
                        if (tagType === 0x08) break;
                        readString();
                        if (tagType === 0x01) readString();
                        else if (tagType === 0x02) readInt32();
                    }
                }
            }
            if (item.appname || item.appid) entries.push(item);
        }
    }
    return entries;
}

const vdfBuf = fs.readFileSync('C:/game/steam/userdata/83513586/config/shortcuts.vdf');
const shortcuts = parseVdf(vdfBuf);

let metadata = {};
const activeMetaPath = 'C:/game/steam/millennium/config/steam-cartridges/library_metadata.json';

if (fs.existsSync(activeMetaPath)) {
    metadata = JSON.parse(fs.readFileSync(activeMetaPath, 'utf8'));
}

console.log('Total shortcuts in VDF:', shortcuts.length);
console.log('Total entries in metadata DB:', Object.keys(metadata).length);

const missing = [];
const withMeta = [];

for (const s of shortcuts) {
    const appid = s.appid >>> 0;
    const meta = metadata[appid] || metadata[String(appid)] || metadata[s.appid];
    if (meta && (meta.description || meta.summary || meta.developers?.length)) {
        withMeta.push({ appid, name: s.appname });
    } else {
        missing.push({
            appid,
            name: s.appname,
            exe: s.exe,
            hasMetaObj: Boolean(meta),
            status: meta?.status
        });
    }
}

console.log('Shortcuts WITH metadata:', withMeta.length);
console.log('Shortcuts MISSING metadata:', missing.length);
console.log('\nSample missing games (first 25):');
for (const m of missing.slice(0, 25)) {
    console.log(`- [${m.appid}] "${m.name}" (hasObj: ${m.hasMetaObj}, status: ${m.status}) exe: ${m.exe?.slice(0, 60)}`);
}
