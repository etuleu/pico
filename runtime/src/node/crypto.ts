// node:crypto subset: hashes, hmac, random. Backed by CryptoKit / SecRandom on the host.
import { Buffer } from "buffer";
import { host } from "../host.ts";

type Data = string | ArrayBufferView;

function toBytes(data: Data, encoding?: BufferEncoding): Uint8Array {
	if (typeof data === "string") {
		return !encoding || encoding === "utf8" || encoding === "utf-8"
			? host.utf8Encode(data)
			: Buffer.from(data, encoding);
	}
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

function output(bytes: Uint8Array, encoding?: BufferEncoding): Buffer | string {
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return encoding ? buffer.toString(encoding) : buffer;
}

function normalizeAlgorithm(alg: string): string {
	return alg.toLowerCase().replace("-", "");
}

export class Hash {
	private readonly alg: string;
	private chunks: Uint8Array[] = [];

	constructor(alg: string) {
		this.alg = normalizeAlgorithm(alg);
	}

	update(data: Data, encoding?: BufferEncoding): this {
		this.chunks.push(toBytes(data, encoding).slice());
		return this;
	}

	digest(encoding?: BufferEncoding): Buffer | string {
		return output(host.digest(this.alg, concat(this.chunks)), encoding);
	}

	copy(): Hash {
		const copy = new Hash(this.alg);
		copy.chunks = [...this.chunks];
		return copy;
	}
}

export class Hmac {
	private readonly alg: string;
	private readonly key: Uint8Array;
	private chunks: Uint8Array[] = [];

	constructor(alg: string, key: Data) {
		this.alg = normalizeAlgorithm(alg);
		this.key = toBytes(key).slice();
	}

	update(data: Data, encoding?: BufferEncoding): this {
		this.chunks.push(toBytes(data, encoding).slice());
		return this;
	}

	digest(encoding?: BufferEncoding): Buffer | string {
		return output(host.hmac(this.alg, this.key, concat(this.chunks)), encoding);
	}
}

export function createHash(alg: string): Hash {
	return new Hash(alg);
}

export function createHmac(alg: string, key: Data): Hmac {
	return new Hmac(alg, key);
}

export function hash(alg: string, data: Data, encoding: BufferEncoding = "hex"): string | Buffer {
	return createHash(alg).update(data).digest(encoding);
}

export function randomBytes(size: number, callback?: (error: Error | null, buf: Buffer) => void): Buffer {
	const bytes = host.randomBytes(size);
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (callback) queueMicrotask(() => callback(null, buffer));
	return buffer;
}

export function randomFillSync<T extends ArrayBufferView>(buffer: T, offset = 0, size?: number): T {
	const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const length = size ?? view.length - offset;
	view.set(host.randomBytes(length), offset);
	return buffer;
}

export function randomInt(min: number, max?: number): number {
	const [lo, hi] = max === undefined ? [0, min] : [min, max];
	const bytes = host.randomBytes(6);
	const value = bytes.reduce((acc, b) => acc * 256 + b, 0);
	return lo + (value % (hi - lo));
}

export function randomUUID(): string {
	return globalThis.crypto.randomUUID();
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
	return globalThis.crypto.getRandomValues(array as unknown as Uint8Array<ArrayBuffer>) as unknown as T;
}

export function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
	const x = toBytes(a);
	const y = toBytes(b);
	if (x.length !== y.length) throw new RangeError("Input buffers must have the same byte length");
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

export function getHashes(): string[] {
	return ["md5", "sha1", "sha256", "sha384", "sha512"];
}

export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto?.subtle;

function unsupported(name: string) {
	return () => {
		throw new Error(`crypto.${name} is not supported on this platform`);
	};
}

export const createCipheriv = unsupported("createCipheriv");
export const createDecipheriv = unsupported("createDecipheriv");
export const createSign = unsupported("createSign");
export const createVerify = unsupported("createVerify");
export const createPublicKey = unsupported("createPublicKey");
export const createPrivateKey = unsupported("createPrivateKey");
export const generateKeyPairSync = unsupported("generateKeyPairSync");
export const pbkdf2Sync = unsupported("pbkdf2Sync");
export const scryptSync = unsupported("scryptSync");
export const sign = unsupported("sign");
export const verify = unsupported("verify");
export const constants = {};

export default {
	createHash,
	createHmac,
	hash,
	randomBytes,
	randomFillSync,
	randomInt,
	randomUUID,
	getRandomValues,
	timingSafeEqual,
	getHashes,
	webcrypto,
	subtle,
	createCipheriv,
	createDecipheriv,
	createSign,
	createVerify,
	createPublicKey,
	createPrivateKey,
	generateKeyPairSync,
	pbkdf2Sync,
	scryptSync,
	sign,
	verify,
	constants,
	Hash,
	Hmac,
};
