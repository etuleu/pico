// node:module: createRequire resolves only built-in modules (there is no node_modules on the device).
import assert from "./assert.ts";
import async_hooks from "./async_hooks.ts";
import buffer from "./buffer.ts";
import child_process from "./child_process.ts";
import crypto from "./crypto.ts";
import diagnostics_channel from "./diagnostics_channel.ts";
import dns from "./dns.ts";
import events from "./events.ts";
import fs from "./fs.ts";
import http from "./http.ts";
import misc from "./misc.ts";
import net from "./net.ts";
import os from "./os.ts";
import path from "./path.ts";
import perf_hooks from "./perf_hooks.ts";
import readline from "./readline.ts";
import stream from "./stream.ts";
import string_decoder from "./string_decoder.ts";
import timers from "./timers.ts";
import tty from "./tty.ts";
import url from "./url.ts";
import util from "./util.ts";
import worker_threads from "./worker_threads.ts";
import zlib from "./zlib.ts";

const registry: Record<string, unknown> = {
	assert,
	async_hooks,
	buffer,
	child_process,
	crypto,
	diagnostics_channel,
	dns,
	events,
	fs,
	"fs/promises": fs.promises,
	http,
	https: http,
	http2: http,
	net,
	tls: net,
	os,
	path,
	perf_hooks,
	process: globalThis.process,
	readline,
	stream,
	"stream/promises": stream.promises,
	string_decoder,
	timers,
	"timers/promises": timers.promises,
	tty,
	url,
	util,
	v8: misc,
	vm: misc,
	worker_threads,
	zlib,
};

export const builtinModules = Object.keys(registry);

export function isBuiltin(id: string): boolean {
	return id.replace(/^node:/, "") in registry;
}

export function createRequire(_from: string | URL) {
	const require = (id: string): unknown => {
		const name = id.replace(/^node:/, "");
		if (name in registry) return registry[name];
		const error = new Error(`Cannot find module '${id}'`) as Error & { code: string };
		error.code = "MODULE_NOT_FOUND";
		throw error;
	};
	require.resolve = (id: string) => {
		if (isBuiltin(id)) return id;
		const error = new Error(`Cannot find module '${id}'`) as Error & { code: string };
		error.code = "MODULE_NOT_FOUND";
		throw error;
	};
	require.cache = {} as Record<string, unknown>;
	return require;
}

export function registerHooks(): { deregister(): void } {
	return { deregister() {} };
}
export function register(): void {}
export function syncBuiltinESMExports(): void {}
export function findPackageJSON(): undefined {
	return undefined;
}
export function enableCompileCache(): { status: number } {
	return { status: 0 };
}
export const constants = { compileCacheStatus: { FAILED: 0, ENABLED: 1, ALREADY_ENABLED: 2, DISABLED: 3 } };
export class Module {
	static builtinModules = builtinModules;
	static createRequire = createRequire;
	static isBuiltin = isBuiltin;
	static _resolveFilename = (id: string) => id;
	static _extensions = {};
	static _cache = {};
}

export default Object.assign(Module, { registerHooks, register, syncBuiltinESMExports, findPackageJSON, enableCompileCache, constants });
