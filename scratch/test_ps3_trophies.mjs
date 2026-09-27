// scratch/test_ps3_trophies.mjs
// Verifies RPCS3 TROPCONF.SFM XML parsing and TROPUSR.DAT binary parsing algorithms.

import fs from 'fs';
import path from 'path';

const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<trophyconf version="1.1" net-version="01.00">
  <npcommid>NPWR01234_00</npcommid>
  <tropsize>1048576</tropsize>
  <trophy id="000" hidden="no" ttype="P" pid="-1">
    <name>Crown of the Conqueror</name>
    <detail>Acquired all trophies.</detail>
  </trophy>
  <trophy id="001" hidden="no" ttype="B" pid="-1">
    <name>The First Step</name>
    <detail>Defeated the prologue boss.</detail>
  </trophy>
  <trophy id="002" hidden="yes" ttype="S" pid="-1">
    <name>Secret Passage</name>
    <detail>Discovered the hidden passage under the castle.</detail>
  </trophy>
  <trophy id="003" hidden="no" ttype="G" pid="-1">
    <name>Legendary Hero</name>
    <detail>Completed the game on Hard difficulty.</detail>
  </trophy>
</trophyconf>`;

// Generate sample TROPUSR.DAT binary
// 64-byte header + 4 * 32-byte records
const header = Buffer.alloc(64);
header.write('TROPUSR', 0, 'ascii');

const records = [];
for (let i = 0; i < 4; i++) {
  const rec = Buffer.alloc(32);
  if (i === 1 || i === 3) {
    // Trophy 1 and 3 unlocked
    rec[0] = 0x01; // unlocked status
    rec.writeUInt32BE(0, 16); // timestamp high
    rec.writeUInt32BE(1760000000 + (i * 100), 20); // timestamp low
  }
  records.push(rec);
}
const tropusrData = Buffer.concat([header, ...records]);

const fixtureDir = 'scratch/fixtures/NPWR01234_00';
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(path.join(fixtureDir, 'TROPCONF.SFM'), sampleXml);
fs.writeFileSync(path.join(fixtureDir, 'TROPUSR.DAT'), tropusrData);

console.log('Sample RPCS3 trophy fixture created at:', fixtureDir);

// Verify XML parsing logic
const npcommid = sampleXml.match(/<npcommid>([^<]+)<\/npcommid>/)?.[1];
const trophies = [];
const trophyRegex = /<trophy\s+([^>]+)>([\s\S]*?)<\/trophy>/g;
let match;
while ((match = trophyRegex.exec(sampleXml)) !== null) {
  const attrs = match[1];
  const body = match[2];
  const id = attrs.match(/id="([^"]+)"/)?.[1];
  const ttype = attrs.match(/ttype="([^"]+)"/)?.[1] || 'B';
  const hidden = attrs.match(/hidden="([^"]+)"/)?.[1] === 'yes';
  const name = body.match(/<name>(.*?)<\/name>/)?.[1];
  const detail = body.match(/<detail>(.*?)<\/detail>/)?.[1];
  trophies.push({ id, ttype, hidden, name, detail });
}

console.log('Parsed npcommid:', npcommid);
console.log('Parsed trophies count:', trophies.length);
if (trophies.length === 4 && npcommid === 'NPWR01234_00') {
  console.log('[PASS] XML Trophy Schema Parsing');
} else {
  console.error('[FAIL] XML Trophy Schema Parsing');
  process.exit(1);
}

// Verify binary TROPUSR.DAT parsing logic
const unlocked = {};
for (let i = 0; i < 4; i++) {
  const offset = 64 + (i * 32);
  const status = tropusrData[offset];
  if (status !== 0) {
    const ts = tropusrData.readUInt32BE(offset + 20);
    unlocked[String(i).padStart(3, '0')] = ts;
  }
}

console.log('Unlocked trophies in binary DAT:', unlocked);
if (unlocked['001'] === 1760000100 && unlocked['003'] === 1760000300) {
  console.log('[PASS] Binary TROPUSR.DAT Parsing');
} else {
  console.error('[FAIL] Binary TROPUSR.DAT Parsing');
  process.exit(1);
}

console.log('\nAll RPCS3 Trophy algorithm tests PASS!');
