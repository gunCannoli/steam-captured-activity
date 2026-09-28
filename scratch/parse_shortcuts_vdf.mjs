import fs from 'fs';

function parseVdf(buffer) {
    let offset = 0;
    const entries = [];

    function readString() {
        const start = offset;
        while (offset < buffer.length && buffer[offset] !== 0) {
            offset++;
        }
        const str = buffer.toString('utf8', start, offset);
        offset++; // skip null
        return str;
    }

    function readInt32() {
        const val = buffer.readInt32LE(offset);
        offset += 4;
        return val;
    }

    // Skip root object header if any
    while (offset < buffer.length) {
        const type = buffer[offset++];
        if (type === 0x08) {
            break; // end of object
        }
        const key = readString();
        if (type === 0x00) {
            // child map (a shortcut entry)
            const item = {};
            while (offset < buffer.length) {
                const itemType = buffer[offset++];
                if (itemType === 0x08) break;
                const itemKey = readString().toLowerCase();
                if (itemType === 0x01) {
                    item[itemKey] = readString();
                } else if (itemType === 0x02) {
                    item[itemKey] = readInt32();
                } else if (itemType === 0x00) {
                    // tags or nested map
                    const tags = [];
                    while (offset < buffer.length) {
                        const tagType = buffer[offset++];
                        if (tagType === 0x08) break;
                        const tagKey = readString();
                        if (tagType === 0x01) tags.push(readString());
                        else if (tagType === 0x02) tags.push(readInt32());
                    }
                    item[itemKey] = tags;
                }
            }
            if (item.appname || item.appid) {
                entries.push(item);
            }
        }
    }
    return entries;
}

const buf = fs.readFileSync('C:/game/steam/userdata/83513586/config/shortcuts.vdf');
const shortcuts = parseVdf(buf);

console.log('Total shortcuts in VDF:', shortcuts.length);
const withoutIcon = shortcuts.filter(s => !s.icon);
const withIcon = shortcuts.filter(s => !!s.icon);
console.log('With icon in VDF:', withIcon.length);
console.log('Without icon in VDF:', withoutIcon.length);
console.log('Sample without icon:', withoutIcon.slice(0, 5).map(s => ({ name: s.appname, appid: s.appid >>> 0, exe: s.exe })));

// Check how many icon paths exist on disk
let iconExists = 0;
let iconMissingDisk = 0;
for (const s of withIcon) {
    if (fs.existsSync(s.icon)) {
        iconExists++;
    } else {
        iconMissingDisk++;
        if (iconMissingDisk <= 5) {
            console.log('Icon path missing on disk:', s.appname, s.icon);
        }
    }
}
console.log('Icon files existing on disk:', iconExists, 'missing on disk:', iconMissingDisk);
