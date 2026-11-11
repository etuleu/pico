// node:child_process on top of host.spawn / host.spawnSync.
import { Buffer } from "buffer";
import { EventEmitter } from "events";
import { Readable, Writable } from "readable-stream";
import { host } from "../host.ts";

type StdioOption = "pipe" | "ignore" | "inherit" | null | undefined | number | object;

export interface SpawnOptions {
	cwd?: string | URL;
	env?: Record<string, string | undefined>;
	shell?: boolean | string;
	stdio?: StdioOption | StdioOption[];
	detached?: boolean;
	signal?: AbortSignal;
	timeout?: number;
	input?: string | ArrayBufferView;
	encoding?: BufferEncoding | "buffer";
	windowsHide?: boolean;
	killSignal?: string | number;
	maxBuffer?: number;
}

function cleanEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env ?? process.env)) if (value !== undefined) out[key] = value;
	return out;
}

function resolveCommand(command: string, args: readonly string[], shell: SpawnOptions["shell"]): [string, string[]] {
	if (!shell) return [command, [...args]];
	const shellPath = typeof shell === "string" ? shell : "/bin/sh";
	return [shellPath, ["-c", [command, ...args].join(" ")]];
}

function stdioAt(stdio: SpawnOptions["stdio"], index: number): StdioOption {
	if (Array.isArray(stdio)) return stdio[index];
	return stdio;
}

function toBytes(data: string | ArrayBufferView): Uint8Array {
	if (typeof data === "string") return host.utf8Encode(data);
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

const signalNumbers: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

export class ChildProcess extends EventEmitter {
	pid: number | undefined;
	stdin: Writable | null = null;
	stdout: Readable | null = null;
	stderr: Readable | null = null;
	stdio: (Readable | Writable | null)[] = [];
	exitCode: number | null = null;
	signalCode: string | null = null;
	killed = false;
	connected = false;
	spawnfile = "";
	spawnargs: string[] = [];
	private handle = 0;

	_start(command: string, args: readonly string[], options: SpawnOptions): void {
		const [file, argv] = resolveCommand(command, args, options.shell);
		this.spawnfile = file;
		this.spawnargs = [file, ...argv];
		const pipeOut = (index: number) => {
			const mode = stdioAt(options.stdio, index);
			return mode === undefined || mode === null || mode === "pipe";
		};
		this.stdin = pipeOut(0)
			? new Writable({
					write: (chunk: Buffer | string, _encoding: string, callback: () => void) => {
						host.spawnWrite(this.handle, toBytes(chunk));
						callback();
					},
					final: (callback: () => void) => {
						host.spawnWrite(this.handle, null);
						callback();
					},
				})
			: null;
		this.stdout = pipeOut(1) ? new Readable({ read() {} }) : null;
		this.stderr = pipeOut(2) ? new Readable({ read() {} }) : null;
		this.stdio = [this.stdin, this.stdout, this.stderr];

		const cwd = options.cwd ? String(options.cwd instanceof URL ? options.cwd.pathname : options.cwd) : process.cwd();
		try {
			this.handle = host.spawn(
				file,
				argv,
				cwd,
				cleanEnv(options.env),
				(chunk) => this.stdout?.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
				(chunk) => this.stderr?.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
				(code, signal) => this._exited(code, signal),
			);
		} catch (error) {
			const failure = error as NodeJS.ErrnoException & { spawnargs?: string[] };
			failure.code ??= "ENOENT";
			failure.syscall = `spawn ${file}`;
			failure.path = file;
			failure.spawnargs = argv;
			queueMicrotask(() => {
				this.emit("error", failure);
				this.stdout?.push(null);
				this.stderr?.push(null);
				this.emit("close", -2, null);
			});
			return;
		}
		this.pid = this.handle;
		queueMicrotask(() => this.emit("spawn"));

		if (options.signal) {
			const signal = options.signal;
			const onAbort = () => {
				this.kill(typeof options.killSignal === "string" ? options.killSignal : "SIGTERM");
				const reason = new Error("The operation was aborted");
				reason.name = "AbortError";
				this.emit("error", reason);
			};
			if (signal.aborted) queueMicrotask(onAbort);
			else signal.addEventListener("abort", onAbort, { once: true });
			this.once("exit", () => signal.removeEventListener("abort", onAbort));
		}
		if (options.timeout && options.timeout > 0) {
			const timer = setTimeout(() => this.kill("SIGTERM"), options.timeout);
			this.once("exit", () => clearTimeout(timer));
		}
	}

	private _exited(code: number | null, signal: string | null): void {
		this.exitCode = code;
		this.signalCode = signal;
		this.stdout?.push(null);
		this.stderr?.push(null);
		this.emit("exit", code, signal);
		// Node emits close after stdio streams end.
		setTimeout(() => this.emit("close", code, signal), 0);
	}

	kill(signal: string | number = "SIGTERM"): boolean {
		if (this.exitCode !== null || this.signalCode !== null || !this.handle) return false;
		const name =
			typeof signal === "number"
				? (Object.keys(signalNumbers).find((k) => signalNumbers[k] === signal) ?? "SIGTERM")
				: signal;
		host.spawnKill(this.handle, name);
		this.killed = true;
		return true;
	}

	ref(): this {
		return this;
	}

	unref(): this {
		return this;
	}

	disconnect(): void {}
}

function normalizeArgs(
	args?: readonly string[] | SpawnOptions,
	options?: SpawnOptions,
): [readonly string[], SpawnOptions] {
	if (Array.isArray(args)) return [args, options ?? {}];
	return [[], (args as SpawnOptions | undefined) ?? options ?? {}];
}

export function spawn(command: string, args?: readonly string[] | SpawnOptions, options?: SpawnOptions): ChildProcess {
	const [argv, opts] = normalizeArgs(args, options);
	const child = new ChildProcess();
	child._start(command, argv, opts);
	return child;
}

type ExecCallback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;

function collect(child: ChildProcess, options: SpawnOptions, callback?: ExecCallback): ChildProcess {
	const out: Buffer[] = [];
	const err: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
	let failed: Error | undefined;
	child.on("error", (error: Error) => {
		failed = error;
	});
	child.on("close", (code: number | null, signal: string | null) => {
		if (!callback) return;
		const encode = (chunks: Buffer[]) =>
			options.encoding === "buffer" ? Buffer.concat(chunks) : Buffer.concat(chunks).toString(options.encoding ?? "utf8");
		const stdout = encode(out);
		const stderr = encode(err);
		if (failed) callback(failed, stdout, stderr);
		else if (code !== 0) {
			const error = Object.assign(new Error(`Command failed: ${child.spawnargs.join(" ")}\n${String(stderr)}`), {
				code,
				signal,
				killed: child.killed,
				cmd: child.spawnargs.join(" "),
				stdout,
				stderr,
			});
			callback(error, stdout, stderr);
		} else callback(null, stdout, stderr);
	});
	return child;
}

export function exec(command: string, options?: SpawnOptions | ExecCallback, callback?: ExecCallback): ChildProcess {
	const opts = typeof options === "function" ? {} : (options ?? {});
	const cb = typeof options === "function" ? options : callback;
	return collect(spawn(command, [], { ...opts, shell: opts.shell ?? true }), opts, cb);
}

export function execFile(
	file: string,
	args?: readonly string[] | SpawnOptions | ExecCallback,
	options?: SpawnOptions | ExecCallback,
	callback?: ExecCallback,
): ChildProcess {
	const argv = Array.isArray(args) ? args : [];
	const rest = [args, options, callback].filter((x) => !Array.isArray(x));
	const opts = (rest.find((x) => typeof x === "object" && x) as SpawnOptions | undefined) ?? {};
	const cb = rest.find((x) => typeof x === "function") as ExecCallback | undefined;
	return collect(spawn(file, argv, opts), opts, cb);
}

export interface SpawnSyncReturns {
	pid: number;
	output: (string | Buffer | null)[];
	stdout: string | Buffer;
	stderr: string | Buffer;
	status: number | null;
	signal: string | null;
	error?: Error;
}

export function spawnSync(
	command: string,
	args?: readonly string[] | SpawnOptions,
	options?: SpawnOptions,
): SpawnSyncReturns {
	const [argv, opts] = normalizeArgs(args, options);
	const [file, fileArgs] = resolveCommand(command, argv, opts.shell);
	const cwd = opts.cwd ? String(opts.cwd) : process.cwd();
	const encode = (bytes: Uint8Array) => {
		const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return opts.encoding && opts.encoding !== "buffer" ? buffer.toString(opts.encoding) : buffer;
	};
	try {
		const result = host.spawnSync(
			file,
			fileArgs,
			cwd,
			cleanEnv(opts.env),
			opts.input === undefined ? null : toBytes(opts.input),
			opts.timeout ?? 0,
		);
		const stdout = encode(result.stdout);
		const stderr = encode(result.stderr);
		return { pid: 0, output: [null, stdout, stderr], stdout, stderr, status: result.status, signal: result.signal };
	} catch (error) {
		const failure = error as NodeJS.ErrnoException;
		failure.code ??= "ENOENT";
		const empty = encode(new Uint8Array(0));
		return { pid: 0, output: [null, empty, empty], stdout: empty, stderr: empty, status: null, signal: null, error: failure };
	}
}

function checkSync(result: SpawnSyncReturns, label: string): string | Buffer {
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw Object.assign(new Error(`Command failed: ${label}\n${String(result.stderr)}`), {
			status: result.status,
			signal: result.signal,
			stdout: result.stdout,
			stderr: result.stderr,
			output: result.output,
		});
	}
	return result.stdout;
}

export function execSync(command: string, options: SpawnOptions = {}): string | Buffer {
	return checkSync(spawnSync(command, [], { ...options, shell: options.shell ?? true }), command);
}

export function execFileSync(
	file: string,
	args?: readonly string[] | SpawnOptions,
	options?: SpawnOptions,
): string | Buffer {
	const [argv, opts] = normalizeArgs(args, options);
	return checkSync(spawnSync(file, argv, opts), [file, ...argv].join(" "));
}

export function fork(): ChildProcess {
	throw new Error("child_process.fork is not supported on this platform");
}

export default { ChildProcess, spawn, exec, execFile, spawnSync, execSync, execFileSync, fork };
