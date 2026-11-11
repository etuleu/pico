// console on top of host.log. Output goes to the host log, never to stdout (stdout is the RPC channel).
import { host } from "../host.ts";
import { format } from "../node/util.ts";

const counts = new Map<string, number>();
const timers = new Map<string, number>();

export const console = {
	log: (...args: unknown[]) => host.log("log", format(...args)),
	info: (...args: unknown[]) => host.log("info", format(...args)),
	debug: (...args: unknown[]) => host.log("debug", format(...args)),
	warn: (...args: unknown[]) => host.log("warn", format(...args)),
	error: (...args: unknown[]) => host.log("error", format(...args)),
	trace: (...args: unknown[]) => host.log("debug", `${format(...args)}\n${new Error().stack ?? ""}`),
	dir: (value: unknown) => host.log("log", format(value)),
	table: (value: unknown) => host.log("log", format(value)),
	assert: (condition: unknown, ...args: unknown[]) => {
		if (!condition) host.log("error", `Assertion failed: ${format(...args)}`);
	},
	count: (label = "default") => {
		const n = (counts.get(label) ?? 0) + 1;
		counts.set(label, n);
		host.log("log", `${label}: ${n}`);
	},
	countReset: (label = "default") => counts.delete(label),
	time: (label = "default") => timers.set(label, host.now()),
	timeEnd: (label = "default") => {
		const start = timers.get(label);
		if (start !== undefined) host.log("log", `${label}: ${(host.now() - start).toFixed(3)}ms`);
		timers.delete(label);
	},
	timeLog: (label = "default") => {
		const start = timers.get(label);
		if (start !== undefined) host.log("log", `${label}: ${(host.now() - start).toFixed(3)}ms`);
	},
	group: () => {},
	groupEnd: () => {},
	groupCollapsed: () => {},
};

export function installConsole(): void {
	globalThis.console = console as unknown as Console;
}
