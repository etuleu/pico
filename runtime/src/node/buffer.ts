// node:buffer: the prelude's Buffer.
import { shared } from "../shared.ts";

export const Buffer = shared.buffer.Buffer;
export const Blob = globalThis.Blob;
export const File = globalThis.File;
export const atob = globalThis.atob;
export const btoa = globalThis.btoa;
export const constants = { MAX_LENGTH: 2 ** 32 - 1, MAX_STRING_LENGTH: 2 ** 29 - 24 };
export const kMaxLength = constants.MAX_LENGTH;
export const SlowBuffer = Buffer;
export function isUtf8(input: ArrayBufferView): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(input);
		return true;
	} catch {
		return false;
	}
}
export function isAscii(input: ArrayBufferView): boolean {
	const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return bytes.every((b) => b < 0x80);
}

export default { Buffer, Blob, File, atob, btoa, constants, kMaxLength, SlowBuffer, isUtf8, isAscii };
