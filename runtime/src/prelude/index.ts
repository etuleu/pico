// Prelude: installs web and Node globals that JavaScriptCore lacks. Runs before the pi bundle.
import "./base.ts";
import "core-js/actual/url";
import "core-js/actual/url-search-params";
import "core-js/actual/structured-clone";
import "core-js/actual/array/from-async";
import "core-js/actual/promise/with-resolvers";
import "core-js/actual/iterator";
import "core-js/actual/set";
import { Buffer } from "buffer";
import * as streams from "web-streams-polyfill";
import { host } from "../host.ts";
import { installFetch } from "./fetch.ts";
import { installProcess } from "./process.ts";
import { TextDecoder, TextEncoder } from "./text.ts";

Object.assign(globalThis, {
	global: globalThis,
	ReadableStream: streams.ReadableStream,
	ReadableStreamDefaultReader: streams.ReadableStreamDefaultReader,
	ReadableByteStreamController: streams.ReadableByteStreamController,
	WritableStream: streams.WritableStream,
	TransformStream: streams.TransformStream,
	ByteLengthQueuingStrategy: streams.ByteLengthQueuingStrategy,
	CountQueuingStrategy: streams.CountQueuingStrategy,
});

class TextDecoderStream extends streams.TransformStream<Uint8Array, string> {
	readonly encoding = "utf-8";

	constructor() {
		const decoder = new TextDecoder();
		super({
			transform(chunk, controller) {
				const text = decoder.decode(chunk, { stream: true });
				if (text) controller.enqueue(text);
			},
			flush(controller) {
				const text = decoder.decode();
				if (text) controller.enqueue(text);
			},
		});
	}
}

class TextEncoderStream extends streams.TransformStream<string, Uint8Array> {
	readonly encoding = "utf-8";

	constructor() {
		const encoder = new TextEncoder();
		super({
			transform(chunk, controller) {
				controller.enqueue(encoder.encode(chunk));
			},
		});
	}
}

Object.assign(globalThis, { TextDecoderStream, TextEncoderStream, Buffer });

installProcess();
installFetch();

function getRandomValues<T extends ArrayBufferView>(array: T): T {
	const bytes = host.randomBytes(array.byteLength);
	new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
	return array;
}

function randomUUID(): string {
	const b = host.randomBytes(16);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const digestNames: Record<string, string> = { "SHA-1": "sha1", "SHA-256": "sha256", "SHA-384": "sha384", "SHA-512": "sha512" };

const subtle = {
	async digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
		const name = typeof algorithm === "string" ? algorithm : algorithm.name;
		const bytes = ArrayBuffer.isView(data)
			? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			: new Uint8Array(data);
		const out = host.digest(digestNames[name.toUpperCase()] ?? name.toLowerCase(), bytes);
		return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
	},
};

(globalThis as unknown as { crypto: unknown }).crypto = { getRandomValues, randomUUID, subtle };

if (typeof globalThis.performance?.now !== "function") {
	(globalThis as unknown as { performance: unknown }).performance = {};
}
const performanceObject = globalThis.performance as unknown as Record<string, unknown>;
const timeOrigin = Date.now() - host.now();
performanceObject.now ??= () => host.now();
performanceObject.timeOrigin ??= timeOrigin;
performanceObject.mark ??= () => undefined;
performanceObject.measure ??= () => undefined;
performanceObject.getEntriesByName ??= () => [];
performanceObject.clearMarks ??= () => undefined;

// Share one copy of these modules with the main bundle (instanceof / Buffer.isBuffer must agree).
import EventEmitterClass from "events";
import * as StreamModule from "readable-stream";
import * as StringDecoderModule from "string_decoder";

(globalThis as unknown as { __picoModules: unknown }).__picoModules = {
	buffer: { Buffer },
	events: EventEmitterClass,
	stream: StreamModule,
	string_decoder: StringDecoderModule,
};
