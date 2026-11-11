// node:util subset.

export function inspect(value: unknown, options: { depth?: number } | boolean = {}): string {
	const depth = typeof options === "object" ? (options.depth ?? 2) : 2;
	return formatValue(value, depth, new Set());
}

inspect.custom = Symbol.for("nodejs.util.inspect.custom");
inspect.defaultOptions = { depth: 2 };

function formatValue(value: unknown, depth: number, seen: Set<unknown>): string {
	if (value === null) return "null";
	switch (typeof value) {
		case "undefined":
			return "undefined";
		case "string":
			return seen.size === 0 ? value : JSON.stringify(value);
		case "number":
		case "boolean":
			return String(value);
		case "bigint":
			return `${value}n`;
		case "symbol":
			return value.toString();
		case "function":
			return `[Function: ${value.name || "(anonymous)"}]`;
	}
	const object = value as Record<string | symbol, unknown>;
	const custom = object[inspect.custom];
	if (typeof custom === "function") return String(custom.call(object, depth, {}));
	if (value instanceof Error) {
		const extra = Object.keys(value).length && depth > 0 ? ` ${formatObject(value, depth, seen)}` : "";
		// JSC stacks omit V8's "Name: message" header line.
		const header = `${value.name}: ${value.message}`;
		const stack = value.stack ? (value.stack.startsWith(header) ? value.stack : `${header}\n${value.stack}`) : header;
		return `${stack}${extra}`;
	}
	if (value instanceof Date) return value.toISOString();
	if (value instanceof RegExp) return String(value);
	if (seen.has(value)) return "[Circular]";
	if (depth < 0) return Array.isArray(value) ? "[Array]" : "[Object]";
	if (ArrayBuffer.isView(value)) {
		const name = value.constructor.name;
		const bytes = new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 50));
		return `<${name} ${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ")}>`;
	}
	if (value instanceof Map) {
		seen.add(value);
		const parts = [...value].map(([k, v]) => `${formatValue(k, depth - 1, seen)} => ${formatValue(v, depth - 1, seen)}`);
		seen.delete(value);
		return `Map(${value.size}) { ${parts.join(", ")} }`;
	}
	if (value instanceof Set) {
		seen.add(value);
		const parts = [...value].map((v) => formatValue(v, depth - 1, seen));
		seen.delete(value);
		return `Set(${value.size}) { ${parts.join(", ")} }`;
	}
	if (Array.isArray(value)) {
		seen.add(value);
		const parts = value.map((v) => formatValue(v, depth - 1, seen));
		seen.delete(value);
		return `[ ${parts.join(", ")} ]`;
	}
	return formatObject(object, depth, seen);
}

function formatObject(object: object, depth: number, seen: Set<unknown>): string {
	seen.add(object);
	const parts = Object.keys(object).map((key) => {
		const label = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
		return `${label}: ${formatValue((object as Record<string, unknown>)[key], depth - 1, seen)}`;
	});
	seen.delete(object);
	const name = object.constructor && object.constructor !== Object ? `${object.constructor.name} ` : "";
	return parts.length ? `${name}{ ${parts.join(", ")} }` : `${name}{}`;
}

export function format(first?: unknown, ...args: unknown[]): string {
	if (typeof first !== "string") return [first, ...args].map((a) => inspect(a)).join(" ");
	let index = 0;
	const out = first.replace(/%[sdifjoO%]/g, (token) => {
		if (token === "%%") return "%";
		if (index >= args.length) return token;
		const arg = args[index++];
		switch (token) {
			case "%s":
				return typeof arg === "string" ? arg : inspect(arg);
			case "%d":
			case "%i":
				return String(token === "%i" ? Number.parseInt(String(arg), 10) : Number(arg));
			case "%f":
				return String(Number.parseFloat(String(arg)));
			case "%j":
				return JSON.stringify(arg);
			default:
				return inspect(arg);
		}
	});
	const rest = args.slice(index).map((a) => (typeof a === "string" ? a : inspect(a)));
	return rest.length ? `${out} ${rest.join(" ")}` : out;
}

export function formatWithOptions(_options: unknown, ...args: unknown[]): string {
	return format(...(args as [unknown, ...unknown[]]));
}

const customPromisify = Symbol.for("nodejs.util.promisify.custom");

export function promisify<T extends (...args: never[]) => unknown>(fn: T): (...args: unknown[]) => Promise<unknown> {
	const custom = (fn as unknown as Record<symbol, unknown>)[customPromisify];
	if (typeof custom === "function") return custom as (...args: unknown[]) => Promise<unknown>;
	return (...args: unknown[]) =>
		new Promise((resolve, reject) => {
			(fn as unknown as (...a: unknown[]) => void)(...args, (error: unknown, result: unknown) =>
				error ? reject(error) : resolve(result),
			);
		});
}

promisify.custom = customPromisify;

export function callbackify(fn: (...args: unknown[]) => Promise<unknown>) {
	return (...args: unknown[]) => {
		const callback = args.pop() as (error: unknown, result?: unknown) => void;
		fn(...args).then(
			(result) => callback(null, result),
			(error) => callback(error),
		);
	};
}

export function inherits(ctor: { prototype: object; super_?: unknown }, superCtor: { prototype: object }): void {
	ctor.super_ = superCtor;
	Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function deprecate<T>(fn: T): T {
	return fn;
}

export function debuglog(): (...args: unknown[]) => void {
	const log = () => {};
	(log as unknown as { enabled: boolean }).enabled = false;
	return log;
}

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
	if (a instanceof Date) return a.getTime() === (b as Date).getTime();
	if (a instanceof Map || a instanceof Set) {
		return isDeepStrictEqual([...a], [...(b as Map<unknown, unknown>)]);
	}
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((key) =>
		isDeepStrictEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
	);
}

const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

export function stripVTControlCharacters(text: string): string {
	return text.replace(ansiPattern, "");
}

export function styleText(_format: string | string[], text: string): string {
	return text;
}

export function getSystemErrorName(code: number): string {
	return `E${code}`;
}

export function aborted(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

export const types = {
	isPromise: (v: unknown) => v instanceof Promise,
	isDate: (v: unknown) => v instanceof Date,
	isRegExp: (v: unknown) => v instanceof RegExp,
	isMap: (v: unknown) => v instanceof Map,
	isSet: (v: unknown) => v instanceof Set,
	isUint8Array: (v: unknown) => v instanceof Uint8Array,
	isTypedArray: (v: unknown) => ArrayBuffer.isView(v) && !(v instanceof DataView),
	isArrayBuffer: (v: unknown) => v instanceof ArrayBuffer,
	isAnyArrayBuffer: (v: unknown) => v instanceof ArrayBuffer || v instanceof SharedArrayBuffer,
	isArrayBufferView: (v: unknown) => ArrayBuffer.isView(v),
	isNativeError: (v: unknown) => v instanceof Error,
	isAsyncFunction: (v: unknown) => typeof v === "function" && v.constructor?.name === "AsyncFunction",
	isGeneratorFunction: (v: unknown) =>
		typeof v === "function" && /GeneratorFunction/.test(v.constructor?.name ?? ""),
	isProxy: () => false,
	isBoxedPrimitive: () => false,
};

export const isArray = Array.isArray;
export const isError = (v: unknown) => v instanceof Error;
export const isFunction = (v: unknown) => typeof v === "function";
export const isString = (v: unknown) => typeof v === "string";

export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

export default {
	inspect,
	format,
	formatWithOptions,
	promisify,
	callbackify,
	inherits,
	deprecate,
	debuglog,
	isDeepStrictEqual,
	stripVTControlCharacters,
	styleText,
	getSystemErrorName,
	aborted,
	types,
	isArray,
	isError,
	isFunction,
	isString,
	TextEncoder,
	TextDecoder,
};
