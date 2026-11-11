// fetch / Headers / Request / Response / Blob / FormData on top of host.fetch (URLSession).
import { ReadableStream } from "web-streams-polyfill";
import { host } from "../host.ts";

type HeadersInit = Headers | [string, string][] | Record<string, string>;

export class Headers {
	private map = new Map<string, [string, string[]]>();

	constructor(init?: HeadersInit) {
		if (!init) return;
		if (init instanceof Headers) init.forEach((value, key) => this.append(key, value));
		else if (Array.isArray(init) || Symbol.iterator in Object(init)) {
			for (const [key, value] of init as Iterable<[string, string]>) this.append(key, value);
		} else for (const key of Object.keys(init)) this.append(key, (init as Record<string, string>)[key]);
	}

	append(name: string, value: string): void {
		const key = name.toLowerCase();
		const entry = this.map.get(key);
		if (entry) entry[1].push(String(value));
		else this.map.set(key, [name, [String(value)]]);
	}

	set(name: string, value: string): void {
		this.map.set(name.toLowerCase(), [name, [String(value)]]);
	}

	get(name: string): string | null {
		const entry = this.map.get(name.toLowerCase());
		return entry ? entry[1].join(", ") : null;
	}

	getSetCookie(): string[] {
		return this.map.get("set-cookie")?.[1] ?? [];
	}

	has(name: string): boolean {
		return this.map.has(name.toLowerCase());
	}

	delete(name: string): void {
		this.map.delete(name.toLowerCase());
	}

	forEach(callback: (value: string, key: string, parent: Headers) => void): void {
		for (const [key, value] of this.entries()) callback(value, key, this);
	}

	*entries(): IterableIterator<[string, string]> {
		const keys = [...this.map.keys()].sort();
		for (const key of keys) yield [key, this.get(key) as string];
	}

	*keys(): IterableIterator<string> {
		for (const [key] of this.entries()) yield key;
	}

	*values(): IterableIterator<string> {
		for (const [, value] of this.entries()) yield value;
	}

	[Symbol.iterator](): IterableIterator<[string, string]> {
		return this.entries();
	}
}

export class Blob {
	readonly _bytes: Uint8Array;
	readonly type: string;

	constructor(parts: unknown[] = [], options: { type?: string } = {}) {
		const chunks = parts.map(toBytes);
		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		this._bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			this._bytes.set(chunk, offset);
			offset += chunk.length;
		}
		this.type = options.type ?? "";
	}

	get size(): number {
		return this._bytes.length;
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		return this._bytes.slice().buffer;
	}

	async bytes(): Promise<Uint8Array> {
		return this._bytes.slice();
	}

	async text(): Promise<string> {
		return host.utf8Decode(this._bytes);
	}

	slice(start?: number, end?: number, type?: string): Blob {
		return new Blob([this._bytes.slice(start, end)], { type });
	}

	stream(): ReadableStream<Uint8Array> {
		return bytesStream(this._bytes);
	}
}

export class File extends Blob {
	readonly name: string;
	readonly lastModified: number;

	constructor(parts: unknown[], name: string, options: { type?: string; lastModified?: number } = {}) {
		super(parts, options);
		this.name = name;
		this.lastModified = options.lastModified ?? Date.now();
	}
}

export class FormData {
	private entries_: [string, string | Blob][] = [];

	append(name: string, value: string | Blob): void {
		this.entries_.push([name, value]);
	}

	get(name: string): string | Blob | null {
		return this.entries_.find(([key]) => key === name)?.[1] ?? null;
	}

	*entries(): IterableIterator<[string, string | Blob]> {
		yield* this.entries_;
	}

	[Symbol.iterator](): IterableIterator<[string, string | Blob]> {
		return this.entries();
	}
}

function toBytes(part: unknown): Uint8Array {
	if (typeof part === "string") return host.utf8Encode(part);
	if (part instanceof Blob) return part._bytes;
	if (part instanceof ArrayBuffer) return new Uint8Array(part);
	if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
	return host.utf8Encode(String(part));
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			if (bytes.length) controller.enqueue(bytes);
			controller.close();
		},
	});
}

type BodyInit = string | ArrayBuffer | ArrayBufferView | Blob | URLSearchParams | FormData | ReadableStream | null;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

async function bodyToBytes(body: BodyInit | undefined): Promise<Uint8Array | null> {
	if (body == null) return null;
	if (body instanceof ReadableStream) return readAll(body);
	if (body instanceof URLSearchParams) return host.utf8Encode(body.toString());
	if (body instanceof FormData) throw new Error("fetch: FormData bodies are not supported yet");
	return toBytes(body);
}

function defaultContentType(body: BodyInit | undefined): string | undefined {
	if (typeof body === "string") return "text/plain;charset=UTF-8";
	if (body instanceof URLSearchParams) return "application/x-www-form-urlencoded;charset=UTF-8";
	if (body instanceof Blob && body.type) return body.type;
	return undefined;
}

class Body {
	_body: ReadableStream<Uint8Array> | null;
	bodyUsed = false;

	constructor(body: ReadableStream<Uint8Array> | null) {
		this._body = body;
	}

	get body(): ReadableStream<Uint8Array> | null {
		return this._body;
	}

	async bytes(): Promise<Uint8Array> {
		if (this.bodyUsed) throw new TypeError("Body has already been consumed");
		this.bodyUsed = true;
		return this._body ? readAll(this._body) : new Uint8Array(0);
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const bytes = await this.bytes();
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	}

	async text(): Promise<string> {
		return host.utf8Decode(await this.bytes());
	}

	async json(): Promise<unknown> {
		return JSON.parse(await this.text());
	}

	async blob(): Promise<Blob> {
		return new Blob([await this.bytes()]);
	}

	async formData(): Promise<FormData> {
		throw new Error("Response.formData is not supported");
	}
}

interface RequestInit {
	method?: string;
	headers?: HeadersInit;
	body?: BodyInit;
	signal?: AbortSignal | null;
	redirect?: string;
	[key: string]: unknown;
}

export class Request extends Body {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly signal: AbortSignal;
	readonly redirect: string;
	readonly _init: BodyInit | undefined;

	constructor(input: string | URL | Request, init: RequestInit = {}) {
		const source = input instanceof Request ? input : undefined;
		const rawBody = init.body !== undefined ? init.body : source?._init;
		super(null);
		this.url = source ? source.url : String(input);
		this.method = (init.method ?? source?.method ?? "GET").toUpperCase();
		this.headers = new Headers(init.headers ?? source?.headers);
		this.signal = init.signal ?? source?.signal ?? new AbortController().signal;
		this.redirect = init.redirect ?? "follow";
		this._init = rawBody;
		const contentType = defaultContentType(rawBody);
		if (contentType && !this.headers.has("content-type")) this.headers.set("content-type", contentType);
	}

	get body(): ReadableStream<Uint8Array> | null {
		if (this._init == null) return null;
		if (this._init instanceof ReadableStream) return this._init;
		return bytesStream(toBytes(this._init));
	}

	clone(): Request {
		return new Request(this);
	}
}

interface ResponseInit {
	status?: number;
	statusText?: string;
	headers?: HeadersInit;
}

export class Response extends Body {
	readonly status: number;
	readonly statusText: string;
	readonly headers: Headers;
	readonly type = "basic";
	url = "";
	redirected = false;

	constructor(body?: BodyInit, init: ResponseInit = {}) {
		const stream =
			body == null
				? null
				: body instanceof ReadableStream
					? body
					: body instanceof URLSearchParams || body instanceof FormData
						? bytesStream(host.utf8Encode(String(body)))
						: bytesStream(toBytes(body));
		super(stream);
		this.status = init.status ?? 200;
		this.statusText = init.statusText ?? "";
		this.headers = new Headers(init.headers);
		const contentType = defaultContentType(body ?? undefined);
		if (contentType && !this.headers.has("content-type")) this.headers.set("content-type", contentType);
	}

	get ok(): boolean {
		return this.status >= 200 && this.status < 300;
	}

	clone(): Response {
		if (!this._body) return new Response(null, this);
		const [a, b] = this._body.tee();
		this._body = a;
		const copy = new Response(b, this);
		copy.url = this.url;
		return copy;
	}

	static json(data: unknown, init: ResponseInit = {}): Response {
		const headers = new Headers(init.headers);
		if (!headers.has("content-type")) headers.set("content-type", "application/json");
		return new Response(JSON.stringify(data), { ...init, headers });
	}

	static error(): Response {
		return new Response(null, { status: 0 });
	}

	static redirect(url: string, status = 302): Response {
		return new Response(null, { status, headers: { location: url } });
	}
}

export async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const request = new Request(input, init);
	const signal = request.signal;
	signal.throwIfAborted();
	const body = await bodyToBytes(request._init);
	const headers: [string, string][] = [...request.headers];

	return new Promise<Response>((resolve, reject) => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		let settled = false;
		let finished = false;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
			cancel() {
				if (!finished) host.fetchAbort(id);
				finished = true;
			},
		});

		const onAbort = () => {
			if (finished) return;
			finished = true;
			host.fetchAbort(id);
			if (!settled) {
				settled = true;
				reject(signal.reason);
			} else controller?.error(signal.reason);
		};

		const id = host.fetch(
			request.url,
			request.method,
			headers,
			body,
			(head) => {
				const response = new Response(stream, {
					status: head.status,
					statusText: head.statusText,
					headers: head.headers,
				});
				response.url = head.url;
				settled = true;
				resolve(response);
			},
			(chunk) => {
				if (!finished) controller?.enqueue(chunk);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				if (finished) return;
				finished = true;
				if (error) {
					const failure = new TypeError(`fetch failed: ${error}`);
					if (!settled) {
						settled = true;
						reject(failure);
					} else controller?.error(failure);
				} else controller?.close();
			},
		);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function installFetch(): void {
	Object.assign(globalThis, { fetch, Headers, Request, Response, Blob, File, FormData });
}
