// TextEncoder / TextDecoder backed by the host's UTF-8 codec (much faster than JS in an interpreter-only JSC).
import { host } from "../host.ts";

function toBytes(input: ArrayBufferView | ArrayBuffer | undefined): Uint8Array {
	if (input === undefined) return new Uint8Array(0);
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

/** Length of the trailing incomplete UTF-8 sequence in `bytes` (0 if the buffer ends on a boundary). */
function incompleteTail(bytes: Uint8Array): number {
	const n = bytes.length;
	for (let back = 1; back <= Math.min(3, n); back++) {
		const b = bytes[n - back];
		if ((b & 0xc0) === 0x80) continue;
		const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
		return need > back ? back : 0;
	}
	return 0;
}

export class TextEncoder {
	readonly encoding = "utf-8";

	encode(input = ""): Uint8Array {
		return host.utf8Encode(String(input));
	}

	encodeInto(input: string, dest: Uint8Array): { read: number; written: number } {
		const bytes = host.utf8Encode(input);
		if (bytes.length <= dest.length) {
			dest.set(bytes);
			return { read: input.length, written: bytes.length };
		}
		// Slow path: encode code point by code point until the destination is full.
		let read = 0;
		let written = 0;
		for (const ch of input) {
			const b = host.utf8Encode(ch);
			if (written + b.length > dest.length) break;
			dest.set(b, written);
			written += b.length;
			read += ch.length;
		}
		return { read, written };
	}
}

export class TextDecoder {
	readonly encoding: string;
	readonly fatal: boolean;
	readonly ignoreBOM: boolean;
	private pending: Uint8Array | undefined;
	private started = false;

	constructor(label = "utf-8", options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
		const normalized = label.toLowerCase();
		if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
			throw new RangeError(`TextDecoder: unsupported encoding ${label}`);
		}
		this.encoding = "utf-8";
		this.fatal = options.fatal ?? false;
		this.ignoreBOM = options.ignoreBOM ?? false;
	}

	decode(input?: ArrayBufferView | ArrayBuffer, options: { stream?: boolean } = {}): string {
		let bytes = toBytes(input);
		if (this.pending) {
			const joined = new Uint8Array(this.pending.length + bytes.length);
			joined.set(this.pending);
			joined.set(bytes, this.pending.length);
			bytes = joined;
			this.pending = undefined;
		}
		if (options.stream) {
			const tail = incompleteTail(bytes);
			if (tail > 0) {
				this.pending = bytes.slice(bytes.length - tail);
				bytes = bytes.subarray(0, bytes.length - tail);
			}
		}
		if (bytes.length === 0) return "";
		const text = host.utf8Decode(bytes);
		const first = !this.started;
		this.started = options.stream === true;
		if (first && !this.ignoreBOM && text.charCodeAt(0) === 0xfeff) return text.slice(1);
		return text;
	}
}

export function installText(): void {
	Object.assign(globalThis, { TextEncoder, TextDecoder });
}
