// Contract between the JS runtime and the native (Swift) host. The host installs `globalThis.__pico`
// before any bundle code runs. Every callback is invoked on the single JS thread.

export interface HostInfo {
	platform: string;
	arch: string;
	home: string;
	tmp: string;
	cwd: string;
	hostname: string;
	pid: number;
	env: Record<string, string>;
	argv: string[];
}

export interface HostStat {
	type: "file" | "dir" | "symlink" | "other";
	size: number;
	mode: number;
	mtimeMs: number;
	atimeMs: number;
	ctimeMs: number;
	birthtimeMs: number;
	ino: number;
	dev: number;
	nlink: number;
	uid: number;
	gid: number;
}

export interface HostDirent {
	name: string;
	type: HostStat["type"];
}

/** Errors thrown by host fs functions carry a Node-style `code` (ENOENT, EEXIST, ...). */
export interface HostFs {
	readFile(path: string): Uint8Array;
	writeFile(path: string, data: Uint8Array, append: boolean): void;
	stat(path: string, followSymlinks: boolean): HostStat;
	readdir(path: string): HostDirent[];
	mkdir(path: string, recursive: boolean): void;
	/** Removes a file, symlink, or (when recursive) a directory tree. Non-recursive dirs must be empty. */
	rm(path: string, recursive: boolean): void;
	rename(from: string, to: string): void;
	copyFile(from: string, to: string): void;
	realpath(path: string): string;
	symlink(target: string, path: string): void;
	readlink(path: string): string;
	chmod(path: string, mode: number): void;
	utimes(path: string, atimeMs: number, mtimeMs: number): void;
	mkdtemp(prefix: string): string;
}

export interface HostFetchResponse {
	status: number;
	statusText: string;
	url: string;
	headers: [string, string][];
}

export interface HostSpawnResult {
	status: number | null;
	signal: string | null;
	stdout: Uint8Array;
	stderr: Uint8Array;
}

export interface PicoHost {
	info: HostInfo;
	log(level: string, message: string): void;
	/** Write to fd 1 (stdout) or 2 (stderr). stdout is the RPC channel to the UI. */
	write(fd: number, data: string): void;
	exit(code: number): void;
	chdir(path: string): void;

	setTimer(ms: number, callback: () => void): number;
	clearTimer(id: number): void;
	/** Monotonic milliseconds. */
	now(): number;

	utf8Encode(text: string): Uint8Array;
	/** Decodes complete UTF-8; invalid sequences become U+FFFD. */
	utf8Decode(bytes: Uint8Array): string;

	randomBytes(length: number): Uint8Array;
	/** alg: md5 | sha1 | sha256 | sha384 | sha512 */
	digest(alg: string, data: Uint8Array): Uint8Array;
	hmac(alg: string, key: Uint8Array, data: Uint8Array): Uint8Array;

	fs: HostFs;

	fetch(
		url: string,
		method: string,
		headers: [string, string][],
		body: Uint8Array | null,
		onResponse: (response: HostFetchResponse) => void,
		onData: (chunk: Uint8Array) => void,
		onEnd: (error: string | null) => void,
	): number;
	fetchAbort(id: number): void;

	/** Starts a process. Returns a handle id. */
	spawn(
		command: string,
		args: string[],
		cwd: string,
		env: Record<string, string>,
		onStdout: (chunk: Uint8Array) => void,
		onStderr: (chunk: Uint8Array) => void,
		onExit: (code: number | null, signal: string | null) => void,
	): number;
	/** Writes to the process stdin; null closes it. */
	spawnWrite(id: number, data: Uint8Array | null): void;
	spawnKill(id: number, signal: string): void;
	/** Signals a spawned process by pid (negative pid: its group). Throws ESRCH if unknown. */
	kill(pid: number, signal: string): boolean;
	spawnSync(
		command: string,
		args: string[],
		cwd: string,
		env: Record<string, string>,
		input: Uint8Array | null,
		timeoutMs: number,
	): HostSpawnResult;
}

declare global {
	var __pico: PicoHost;
}

export const host: PicoHost = globalThis.__pico;
