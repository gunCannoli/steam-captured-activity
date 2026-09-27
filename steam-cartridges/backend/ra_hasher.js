const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

function getRomMd5(filePath) {
    if (!fs.existsSync(filePath)) {
        return { error: 'file_not_found' };
    }
    
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

        if (compMethod === 8) { // Deflate
            romBytes = zlib.inflateRawSync(zipBuf.subarray(dataStart, dataStart + compSize));
        } else if (compMethod === 0) { // Store
            romBytes = zipBuf.subarray(dataStart, dataStart + uncompSize);
        } else {
            return { error: 'unsupported_compression_' + compMethod };
        }
    } else {
        romBytes = fs.readFileSync(filePath);
    }

    // Strip 512-byte SMC / copier header if present (e.g. SNES)
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
