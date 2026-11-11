// Global `process`. stdout is the RPC channel to the host UI; stdin is fed by the host via `__picoStdin`.
import { EventEmitter } from "events";
import { Readable } from "readable-stream";
import { host } from "../host.ts";

type WriteCallback = (error?: Error | null) => void;

class HostWriteStream extends EventEmitter {
	readonly fd: number;
	isTTY = false;
	writable = true;
	columns = 120;
	rows = 40;

	constructor(fd: number) {
		super();
		this.fd = fd;
	}

	write(chunk: string | Uint8Array, encodingOrCallback?: string | WriteCallback, callback?: WriteCallback): boolean {
		const text = typeof chunk === "string" ? chunk : host.utf8Decode(chunk);
		host.write(this.fd, text);
		const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		if (cb) queueMicrotask(() => cb(null));
		return true;
	}

	end(chunk?: string | Uint8Array, callback?: WriteCallback): this {
		if (chunk) this.write(chunk);
		callback?.(null);
		return this;
	}

	cork(): void {}
	uncork(): void {}
	getColorDepth(): number {
		return 1;
	}
	hasColors(): boolean {
		return false;
	}
	getWindowSize(): [number, number] {
		return [this.columns, this.rows];
	}
}

const info = host.info;
const startTime = host.now();

const stdin = new Readable({ read() {} }) as Readable & { isTTY: boolean; fd: number; setRawMode: () => void };
stdin.isTTY = false;
stdin.fd = 0;
stdin.setRawMode = () => {};

const emitter = new EventEmitter();

function hrtime(previous?: [number, number]): [number, number] {
	const ns = BigInt(Math.round(host.now() * 1e6));
	let sec = Number(ns / 1_000_000_000n);
	let nsec = Number(ns % 1_000_000_000n);
	if (previous) {
		sec -= previous[0];
		nsec -= previous[1];
		if (nsec < 0) {
			sec -= 1;
			nsec += 1e9;
		}
	}
	return [sec, nsec];
}
hrtime.bigint = () => BigInt(Math.round(host.now() * 1e6));

let currentCwd = info.cwd;
let exiting = false;

const processObject = Object.assign(emitter, {
	title: "pi",
	version: "v22.19.0",
	versions: { node: "22.19.0", v8: "0", uv: "0", modules: "127", pico: "0.1.0" } as Record<string, string>,
	release: { name: "node" },
	platform: info.platform,
	arch: info.arch,
	pid: info.pid,
	ppid: 0,
	execPath: "/pico/node",
	execArgv: [] as string[],
	argv: ["/pico/node", "/pico/pi.js", ...info.argv],
	argv0: "node",
	env: { ...info.env } as Record<string, string | undefined>,
	exitCode: undefined as number | undefined,
	stdout: new HostWriteStream(1),
	stderr: new HostWriteStream(2),
	stdin,
	features: {} as Record<string, boolean>,
	config: { variables: {} },
	cwd: () => currentCwd,
	chdir: (dir: string) => {
		host.chdir(dir);
		currentCwd = host.fs.realpath(dir);
	},
	umask: () => 0o022,
	getuid: () => 501,
	getgid: () => 20,
	geteuid: () => 501,
	getegid: () => 20,
	hrtime,
	uptime: () => (host.now() - startTime) / 1000,
	memoryUsage: Object.assign(() => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }), {
		rss: () => 0,
	}),
	cpuUsage: () => ({ user: 0, system: 0 }),
	resourceUsage: () => ({}),
	nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
		queueMicrotask(() => callback(...args));
	},
	emitWarning: (warning: unknown) => {
		host.log("warn", String(warning));
	},
	exit: (code?: number) => {
		const exitCode = code ?? processObject.exitCode ?? 0;
		if (!exiting) {
			exiting = true;
			emitter.emit("exit", exitCode);
		}
		host.exit(exitCode);
	},
	abort: () => host.exit(134),
	kill: (pid: number, signal: string | number = "SIGTERM") => {
		const name = typeof signal === "number" ? ({ 1: "SIGHUP", 2: "SIGINT", 9: "SIGKILL", 15: "SIGTERM" } as Record<number, string>)[signal] ?? "SIGTERM" : signal;
		return host.kill(pid, name);
	},
	binding: () => {
		throw new Error("process.binding is not supported");
	},
	getBuiltinModule: () => undefined,
	setUncaughtExceptionCaptureCallback: () => {},
	hasUncaughtExceptionCaptureCallback: () => false,
});

export type PicoProcess = typeof processObject;

export function installProcess(): void {
	(globalThis as unknown as { process: PicoProcess }).process = processObject;
	(globalThis as unknown as { __picoStdin: (text: string | null) => void }).__picoStdin = (text) => {
		stdin.push(text === null ? null : text);
	};
}
