// node:assert subset.
import { inspect, isDeepStrictEqual } from "./util.ts";

export class AssertionError extends Error {
	readonly code = "ERR_ASSERTION";
	readonly actual: unknown;
	readonly expected: unknown;
	readonly operator: string;
	constructor(options: { message?: string; actual?: unknown; expected?: unknown; operator?: string }) {
		super(options.message ?? `${inspect(options.actual)} ${options.operator} ${inspect(options.expected)}`);
		this.name = "AssertionError";
		this.actual = options.actual;
		this.expected = options.expected;
		this.operator = options.operator ?? "==";
	}
}

function fail(message: string | Error | undefined, actual: unknown, expected: unknown, operator: string): never {
	if (message instanceof Error) throw message;
	throw new AssertionError({ message, actual, expected, operator });
}

export function ok(value: unknown, message?: string | Error): asserts value {
	if (!value) fail(message ?? "The expression evaluated to a falsy value", value, true, "==");
}

export function equal(actual: unknown, expected: unknown, message?: string | Error): void {
	// biome-ignore lint/suspicious/noDoubleEquals: node:assert.equal is loose by definition
	if (actual != expected) fail(message, actual, expected, "==");
}
export function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
	// biome-ignore lint/suspicious/noDoubleEquals: node:assert.notEqual is loose by definition
	if (actual == expected) fail(message, actual, expected, "!=");
}
export function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
	if (!Object.is(actual, expected)) fail(message, actual, expected, "===");
}
export function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
	if (Object.is(actual, expected)) fail(message, actual, expected, "!==");
}
export function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
	if (!isDeepStrictEqual(actual, expected)) fail(message, actual, expected, "deepStrictEqual");
}
export const deepEqual = deepStrictEqual;
export function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
	if (isDeepStrictEqual(actual, expected)) fail(message, actual, expected, "notDeepStrictEqual");
}
export function throws(fn: () => unknown, _expected?: unknown, message?: string | Error): void {
	try {
		fn();
	} catch {
		return;
	}
	fail(message ?? "Missing expected exception.", undefined, undefined, "throws");
}
export async function rejects(promise: Promise<unknown> | (() => Promise<unknown>), _expected?: unknown, message?: string | Error) {
	try {
		await (typeof promise === "function" ? promise() : promise);
	} catch {
		return;
	}
	fail(message ?? "Missing expected rejection.", undefined, undefined, "rejects");
}
export function match(value: string, pattern: RegExp, message?: string | Error): void {
	if (!pattern.test(value)) fail(message, value, pattern, "match");
}
export function ifError(value: unknown): void {
	if (value !== null && value !== undefined) throw value;
}

const assert = Object.assign((value: unknown, message?: string | Error) => ok(value, message), {
	ok,
	equal,
	notEqual,
	strictEqual,
	notStrictEqual,
	deepStrictEqual,
	deepEqual,
	notDeepStrictEqual,
	throws,
	rejects,
	match,
	ifError,
	fail: (message?: string) => fail(message ?? "Failed", undefined, undefined, "fail"),
	AssertionError,
});
Object.assign(assert, { strict: assert });

export const strict = assert;
export default assert;
