// node:zlib: crc32 in JS; compression is not available yet.
import { unsupported } from "./unsupported.ts";

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(data: string | ArrayBufferView, value = 0): number {
	const bytes =
		typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	let crc = (value ^ 0xffffffff) >>> 0;
	for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

export const deflateRawSync = unsupported("zlib.deflateRawSync");
export const inflateRawSync = unsupported("zlib.inflateRawSync");
export const deflateSync = unsupported("zlib.deflateSync");
export const inflateSync = unsupported("zlib.inflateSync");
export const gzipSync = unsupported("zlib.gzipSync");
export const gunzipSync = unsupported("zlib.gunzipSync");
export const brotliDecompressSync = unsupported("zlib.brotliDecompressSync");
export const createGunzip = unsupported("zlib.createGunzip");
export const createInflate = unsupported("zlib.createInflate");
export const createBrotliDecompress = unsupported("zlib.createBrotliDecompress");
export const createZstdDecompress = unsupported("zlib.createZstdDecompress");
export const zstdDecompressSync = unsupported("zlib.zstdDecompressSync");
export const zstdCompressSync = unsupported("zlib.zstdCompressSync");
export const gzip = unsupported("zlib.gzip");
export const gunzip = unsupported("zlib.gunzip");
export const constants = {
	Z_NO_FLUSH: 0,
	Z_SYNC_FLUSH: 2,
	Z_FINISH: 4,
	BROTLI_OPERATION_FLUSH: 1,
	ZSTD_e_flush: 1,
};

export default {
	crc32,
	deflateRawSync,
	inflateRawSync,
	deflateSync,
	inflateSync,
	gzipSync,
	gunzipSync,
	brotliDecompressSync,
	createGunzip,
	createInflate,
	createBrotliDecompress,
	createZstdDecompress,
	zstdDecompressSync,
	zstdCompressSync,
	gzip,
	gunzip,
	constants,
};
