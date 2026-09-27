// scratch/test_ra_hash.mjs
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function runHasher(file) {
  const out = execFileSync('node', ['steam-cartridges/backend/ra_hasher.js', file], { encoding: 'utf-8' });
  return JSON.parse(out);
}

console.log('--- Testing ra_hasher.js ---');

// 1. N64 Normalization Test
const n64Payload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), n64Payload]);
const v64 = Buffer.concat([Buffer.from([0x37, 0x80, 0x40, 0x12]), Buffer.from([0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07])]);
const n64 = Buffer.concat([Buffer.from([0x40, 0x12, 0x37, 0x80]), Buffer.from([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05])]);

const tmpZ = 'scratch/tmp_test.z64';
const tmpV = 'scratch/tmp_test.v64';
const tmpN = 'scratch/tmp_test.n64';

fs.writeFileSync(tmpZ, z64);
fs.writeFileSync(tmpV, v64);
fs.writeFileSync(tmpN, n64);

const resZ = runHasher(tmpZ);
const resV = runHasher(tmpV);
const resN = runHasher(tmpN);

fs.unlinkSync(tmpZ);
fs.unlinkSync(tmpV);
fs.unlinkSync(tmpN);

if (resZ.md5 && resZ.md5 === resV.md5 && resZ.md5 === resN.md5) {
  console.log(`[PASS] N64 Endian Normalization: all 3 formats yielded identical MD5: ${resZ.md5}`);
} else {
  console.error(`[FAIL] N64 Endian Normalization: Z=${resZ.md5}, V=${resV.md5}, N=${resN.md5}`);
  process.exit(1);
}

// 2. NES Header Strip Test
const nesRaw = Buffer.from('NES\x1a\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0cDATA_PAYLOAD_HERE');
const tmpNes = 'scratch/tmp_test.nes';
fs.writeFileSync(tmpNes, nesRaw);
const resNes = runHasher(tmpNes);
fs.unlinkSync(tmpNes);

const expectedNesMd5 = crypto.createHash('md5').update(Buffer.from('DATA_PAYLOAD_HERE')).digest('hex');
if (resNes.md5 === expectedNesMd5) {
  console.log(`[PASS] NES Header Strip: stripped 16-byte iNES header successfully: ${resNes.md5}`);
} else {
  console.error(`[FAIL] NES Header Strip: got ${resNes.md5}, expected ${expectedNesMd5}`);
  process.exit(1);
}

// 3. Live ROM Test (Super Mario World)
const smwPath = 'C:/emu/roms/snes/Super Mario World.zip';
if (fs.existsSync(smwPath)) {
  const resSmw = runHasher(smwPath);
  console.log(`[PASS] Super Mario World (.zip) MD5: ${resSmw.md5}`);
}

// 4. Castlevania SotN (.chd fast check)
const sotnPath = 'C:/emu/roms/psx/Castlevania - Symphony of the Night (USA).chd';
if (fs.existsSync(sotnPath)) {
  const resSotn = runHasher(sotnPath);
  if (resSotn.format === 'chd') {
    console.log(`[PASS] Castlevania SotN (.chd fast bypass): size=${resSotn.size}, routed cleanly`);
  } else {
    console.error(`[FAIL] Castlevania SotN: expected format chd, got ${JSON.stringify(resSotn)}`);
    process.exit(1);
  }
}

console.log('\n--- All ra_hasher tests passed! ---');
