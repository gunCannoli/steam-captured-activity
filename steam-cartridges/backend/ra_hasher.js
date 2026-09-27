// steam-cartridges/backend/ra_hasher.js
// Multi-console ROM and Disc hasher for RetroAchievements integration.
// Supports:
//   - SNES SMC header stripping (512 bytes)
//   - NES iNES header stripping (16 bytes, NES\x1a)
//   - N64 endian normalization (.z64 / .v64 / .n64 -> big-endian)
//   - Genesis SMD header stripping and 16KB block de-interleaving
//   - Multi-disc .m3u playlist unwrapping to Disc 1
//   - PS1 / PS2 ISO-9660 SYSTEM.CNF boot executable extraction
//   - Compressed .chd fast detection (routes to title matching)
//   - In-memory .zip stream deflation

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

function normalizeN64(buf) {
  if (buf.length < 4) return buf;
  const magic = buf.readUInt32BE(0);
  if (magic === 0x80371240) {
    // Already big-endian (.z64)
    return buf;
  }
  const out = Buffer.from(buf);
  if (magic === 0x37804012) {
    // Byte-swapped (.v64): swap each 16-bit word
    for (let i = 0; i < out.length - 1; i += 2) {
      const b0 = out[i];
      out[i] = out[i + 1];
      out[i + 1] = b0;
    }
    return out;
  }
  if (magic === 0x40123780) {
    // Little-endian (.n64): swap each 32-bit dword
    for (let i = 0; i < out.length - 3; i += 4) {
      const b0 = out[i], b1 = out[i + 1], b2 = out[i + 2], b3 = out[i + 3];
      out[i] = b3;
      out[i + 1] = b2;
      out[i + 2] = b1;
      out[i + 3] = b0;
    }
    return out;
  }
  return buf;
}

function stripNesHeader(buf) {
  if (buf.length > 16 && buf[0] === 0x4E && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1A) {
    return buf.subarray(16);
  }
  return buf;
}

function normalizeSmd(buf) {
  if (buf.length > 512 && buf[0] === 0xAA && buf[1] === 0xBB && buf[2] === 0x06) {
    const raw = buf.subarray(512);
    const out = Buffer.alloc(raw.length);
    const blockSize = 16384;
    const half = 8192;
    for (let blockStart = 0; blockStart < raw.length; blockStart += blockSize) {
      const curBlockSize = Math.min(blockSize, raw.length - blockStart);
      const curHalf = Math.min(half, Math.floor(curBlockSize / 2));
      for (let j = 0; j < curHalf; j++) {
        if (blockStart + half + j < raw.length) {
          out[blockStart + (2 * j)] = raw[blockStart + half + j];     // even
        }
        if (blockStart + j < raw.length) {
          out[blockStart + (2 * j) + 1] = raw[blockStart + j];        // odd
        }
      }
    }
    return out;
  }
  return buf;
}

function hashIso9660Executable(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(65536);
    fs.readSync(fd, headerBuf, 0, 65536, 0);

    let sectorSize = 2048;
    let pvdOffset = 16 * 2048; // 32768
    let isIso = false;

    // Check 2048-byte Mode 1 PVD
    if (headerBuf.subarray(pvdOffset + 1, pvdOffset + 6).toString('ascii') === 'CD001') {
      isIso = true;
    } else {
      // Check 2352-byte RAW/BIN Mode 2 PVD (Sector 16 sync 16 bytes + 2352*16)
      pvdOffset = (16 * 2352) + 16;
      if (pvdOffset + 6 <= headerBuf.length && headerBuf.subarray(pvdOffset + 1, pvdOffset + 6).toString('ascii') === 'CD001') {
        sectorSize = 2352;
        isIso = true;
      }
    }

    if (!isIso) return null;

    // Root directory record starts at PVD offset + 156
    const rootRecord = headerBuf.subarray(pvdOffset + 156, pvdOffset + 156 + 34);
    const rootSector = rootRecord.readUInt32LE(2);
    const rootDataLen = rootRecord.readUInt32LE(10);

    const rootDirBuf = Buffer.alloc(Math.min(rootDataLen, 32768));
    const rootBytePos = sectorSize === 2048 ? rootSector * 2048 : (rootSector * 2352) + 16;
    fs.readSync(fd, rootDirBuf, 0, rootDirBuf.length, rootBytePos);

    // Read root directory entries looking for SYSTEM.CNF
    let systemCnfSector = 0;
    let systemCnfLen = 0;
    let pos = 0;

    while (pos < rootDirBuf.length) {
      const len = rootDirBuf[pos];
      if (len === 0) {
        // Sector boundary padding
        const nextSector = Math.ceil((pos + 1) / 2048) * 2048;
        if (nextSector <= pos || nextSector >= rootDirBuf.length) break;
        pos = nextSector;
        continue;
      }
      const nameLen = rootDirBuf[pos + 32];
      const name = rootDirBuf.subarray(pos + 33, pos + 33 + nameLen).toString('ascii');
      if (name.startsWith('SYSTEM.CNF')) {
        systemCnfSector = rootDirBuf.readUInt32LE(pos + 2);
        systemCnfLen = rootDirBuf.readUInt32LE(pos + 10);
        break;
      }
      pos += len;
    }

    if (!systemCnfSector || systemCnfLen === 0) return null;

    const cnfBuf = Buffer.alloc(systemCnfLen);
    const cnfBytePos = sectorSize === 2048 ? systemCnfSector * 2048 : (systemCnfSector * 2352) + 16;
    fs.readSync(fd, cnfBuf, 0, cnfBuf.length, cnfBytePos);
    const cnfText = cnfBuf.toString('ascii');

    // Parse BOOT = cdrom:\SLUS_000.67;1
    const bootMatch = cnfText.match(/BOOT\d*\s*=\s*cdrom:\\?([^;]+)/i);
    if (!bootMatch) return null;
    const exeName = path.basename(bootMatch[1].trim()).toUpperCase();

    // Re-scan directory for the boot executable
    pos = 0;
    let exeSector = 0;
    let exeLen = 0;
    while (pos < rootDirBuf.length) {
      const len = rootDirBuf[pos];
      if (len === 0) {
        const nextSector = Math.ceil((pos + 1) / 2048) * 2048;
        if (nextSector <= pos || nextSector >= rootDirBuf.length) break;
        pos = nextSector;
        continue;
      }
      const nameLen = rootDirBuf[pos + 32];
      const name = rootDirBuf.subarray(pos + 33, pos + 33 + nameLen).toString('ascii').toUpperCase();
      if (name.startsWith(exeName)) {
        exeSector = rootDirBuf.readUInt32LE(pos + 2);
        exeLen = rootDirBuf.readUInt32LE(pos + 10);
        break;
      }
      pos += len;
    }

    if (!exeSector || exeLen === 0 || exeLen > 33554432) return null; // cap at 32MB

    const exeBuf = Buffer.alloc(exeLen);
    const exeBytePos = sectorSize === 2048 ? exeSector * 2048 : (exeSector * 2352) + 16;
    fs.readSync(fd, exeBuf, 0, exeLen, exeBytePos);

    return crypto.createHash('md5').update(exeBuf).digest('hex');
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
    }
  }
}

function getRomMd5(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'file_not_found' };
  }

  // 1. Unwrap .m3u playlist files
  if (filePath.toLowerCase().endsWith('.m3u')) {
    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('#')) {
          const resolved = path.isAbsolute(trimmed)
            ? trimmed
            : path.join(path.dirname(filePath), trimmed);
          if (fs.existsSync(resolved)) {
            return getRomMd5(resolved);
          }
        }
      }
    } catch (e) {}
  }

  const stat = fs.statSync(filePath);

  // 2. Compressed disc images (.chd)
  if (filePath.toLowerCase().endsWith('.chd')) {
    return { format: 'chd', size: stat.size, md5: null };
  }

  // 3. PS1/PS2 Disc images (.iso, .bin)
  if (filePath.toLowerCase().endsWith('.iso') || filePath.toLowerCase().endsWith('.bin')) {
    const exeMd5 = hashIso9660Executable(filePath);
    if (exeMd5) {
      return { md5: exeMd5, size: stat.size, format: 'iso_executable' };
    }
  }

  // 4. In-memory .zip stream deflation
  let romBytes;
  if (filePath.toLowerCase().endsWith('.zip')) {
    const zipBuf = fs.readFileSync(filePath);
    if (zipBuf.length < 30 || zipBuf.readUInt32LE(0) !== 0x04034b50) {
      return { error: 'invalid_zip' };
    }
    const compMethod = zipBuf.readUInt16LE(8);
    const compSize = zipBuf.readUInt32LE(18);
    const uncompSize = zipBuf.readUInt32LE(22);
    const fnLen = zipBuf.readUInt16LE(26);
    const extraLen = zipBuf.readUInt16LE(28);
    const dataStart = 30 + fnLen + extraLen;

    if (compMethod === 8) {
      romBytes = zlib.inflateRawSync(zipBuf.subarray(dataStart, dataStart + compSize));
    } else if (compMethod === 0) {
      romBytes = zipBuf.subarray(dataStart, dataStart + uncompSize);
    } else {
      return { error: 'unsupported_compression_' + compMethod };
    }
  } else {
    // Guard against loading gigantic files (> 100MB) directly into memory
    if (stat.size > 104857600) {
      return { format: 'large_disc', size: stat.size, md5: null };
    }
    romBytes = fs.readFileSync(filePath);
  }

  // 5. NES iNES header strip
  romBytes = stripNesHeader(romBytes);

  // 6. N64 endian normalization
  romBytes = normalizeN64(romBytes);

  // 7. Sega Genesis SMD de-interleaving
  romBytes = normalizeSmd(romBytes);

  // 8. SNES SMC header strip (512 bytes)
  if (romBytes.length % 1024 === 512) {
    romBytes = romBytes.subarray(512);
  }

  const md5 = crypto.createHash('md5').update(romBytes).digest('hex');
  return { md5, size: romBytes.length };
}

const targetPath = process.argv[2];
if (!targetPath) {
  console.log(JSON.stringify({ error: 'missing_argument' }));
  process.exit(1);
}

const result = getRomMd5(targetPath);
console.log(JSON.stringify(result));
