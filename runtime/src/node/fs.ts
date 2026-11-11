// node:fs on top of the host file system. The sync API is the core; callback and promise APIs wrap it.
import { Buffer } from "buffer";
import { EventEmitter } from "events";
import { Readable, Writable } from "readable-stream";
import { type HostStat, host } from "../host.ts";

type PathLike = string | Buffer | URL;
type Encoding = BufferEncoding | null | undefined;
type EncodingOption = Encoding | { encoding?: Encoding; flag?: string; mode?: number; signal?: AbortSignal };

export const constants = {
	F_OK: 0,
	R_OK: 4,
	W_OK: 2,
	X_OK: 1,
	O_RDONLY: 0,
	O_WRONLY: 1,
	O_RDWR: 2,
	O_CREAT: 0x200,
	O_EXCL: 0x800,
	O_TRUNC: 0x400,
	O_APPEND: 0x8,
	O_SYNC: 0x80,
	O_NOFOLLOW: 0x100,
	O_DIRECTORY: 0x100000,
	S_IFMT: 0o170000,
	S_IFREG: 0o100000,
	S_IFDIR: 0o040000,
	S_IFLNK: 0o120000,
	COPYFILE_EXCL: 1,
	COPYFILE_FICLONE: 2,
	COPYFILE_FICLONE_FORCE: 4,
	UV_FS_O_FILEMAP: 0,
};

export const F_OK = constants.F_OK;
export const R_OK = constants.R_OK;
export const W_OK = constants.W_OK;
export const X_OK = constants.X_OK;

function toPath(path: PathLike | number): string {
	if (typeof path === "number") return fdEntry(path).path;
	if (typeof path === "string") return path;
	if (path instanceof URL) {
		if (path.protocol !== "file:") throw new TypeError(`The URL must be of scheme file: ${path.href}`);
		return decodeURIComponent(path.pathname);
	}
	return path.toString("utf8");
}

function makeError(code: string, syscall: string, path: string, message: string): Error {
	const error = new Error(`${code}: ${message}, ${syscall} '${path}'`) as NodeJS.ErrnoException;
	error.code = code;
	error.syscall = syscall;
	error.path = path;
	error.errno = -1;
	return error;
}

/** Re-throws host errors with Node's message shape (`ENOENT: no such file or directory, open '/x'`). */
function call<T>(syscall: string, path: string, fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code) throw makeError(code, syscall, path, messageFor(code, error));
		throw error;
	}
}

function messageFor(code: string, error: unknown): string {
	switch (code) {
		case "ENOENT":
			return "no such file or directory";
		case "EEXIST":
			return "file already exists";
		case "ENOTDIR":
			return "not a directory";
		case "EISDIR":
			return "illegal operation on a directory";
		case "ENOTEMPTY":
			return "directory not empty";
		case "EACCES":
			return "permission denied";
		case "EPERM":
			return "operation not permitted";
		default:
			return (error as Error).message;
	}
}

function encodingOf(options: EncodingOption): Encoding {
	if (options == null) return undefined;
	if (typeof options === "string") return options;
	return options.encoding;
}

function toBytes(data: string | ArrayBufferView, encoding?: Encoding): Uint8Array {
	if (typeof data === "string") {
		return !encoding || encoding === "utf8" || encoding === "utf-8"
			? host.utf8Encode(data)
			: Buffer.from(data, encoding);
	}
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function toBuffer(bytes: Uint8Array): Buffer {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decode(bytes: Uint8Array, encoding: Encoding): string | Buffer {
	if (!encoding || (encoding as string) === "buffer") return toBuffer(bytes);
	if (encoding === "utf8" || encoding === "utf-8") return host.utf8Decode(bytes);
	return toBuffer(bytes).toString(encoding);
}

const typeBits: Record<HostStat["type"], number> = {
	file: constants.S_IFREG,
	dir: constants.S_IFDIR,
	symlink: constants.S_IFLNK,
	other: 0,
};

export class Stats {
	dev: number;
	ino: number;
	mode: number;
	nlink: number;
	uid: number;
	gid: number;
	rdev = 0;
	size: number;
	blksize = 4096;
	blocks: number;
	atimeMs: number;
	mtimeMs: number;
	ctimeMs: number;
	birthtimeMs: number;
	atime: Date;
	mtime: Date;
	ctime: Date;
	birthtime: Date;
	private readonly kind: HostStat["type"];

	constructor(stat: HostStat) {
		this.kind = stat.type;
		this.dev = stat.dev;
		this.ino = stat.ino;
		this.mode = (stat.mode & 0o7777) | typeBits[stat.type];
		this.nlink = stat.nlink;
		this.uid = stat.uid;
		this.gid = stat.gid;
		this.size = stat.size;
		this.blocks = Math.ceil(stat.size / 512);
		this.atimeMs = stat.atimeMs;
		this.mtimeMs = stat.mtimeMs;
		this.ctimeMs = stat.ctimeMs;
		this.birthtimeMs = stat.birthtimeMs;
		this.atime = new Date(stat.atimeMs);
		this.mtime = new Date(stat.mtimeMs);
		this.ctime = new Date(stat.ctimeMs);
		this.birthtime = new Date(stat.birthtimeMs);
	}

	isFile(): boolean {
		return this.kind === "file";
	}
	isDirectory(): boolean {
		return this.kind === "dir";
	}
	isSymbolicLink(): boolean {
		return this.kind === "symlink";
	}
	isFIFO(): boolean {
		return false;
	}
	isSocket(): boolean {
		return false;
	}
	isBlockDevice(): boolean {
		return false;
	}
	isCharacterDevice(): boolean {
		return false;
	}
}

export class Dirent {
	name: string;
	parentPath: string;
	path: string;
	private readonly kind: HostStat["type"];

	constructor(name: string, kind: HostStat["type"], parentPath: string) {
		this.name = name;
		this.kind = kind;
		this.parentPath = parentPath;
		this.path = parentPath;
	}

	isFile(): boolean {
		return this.kind === "file";
	}
	isDirectory(): boolean {
		return this.kind === "dir";
	}
	isSymbolicLink(): boolean {
		return this.kind === "symlink";
	}
	isFIFO(): boolean {
		return false;
	}
	isSocket(): boolean {
		return false;
	}
	isBlockDevice(): boolean {
		return false;
	}
	isCharacterDevice(): boolean {
		return false;
	}
}

// ---- sync API ----

export function readFileSync(path: PathLike | number, options?: EncodingOption): string | Buffer {
	const p = toPath(path);
	const bytes = call("open", p, () => host.fs.readFile(p));
	return decode(bytes, encodingOf(options));
}

export function writeFileSync(
	path: PathLike | number,
	data: string | ArrayBufferView,
	options?: EncodingOption,
): void {
	// With an fd, Node writes at the descriptor's current position (no truncation).
	if (typeof path === "number") {
		writeSync(path, toBytes(data, encodingOf(options)));
		return;
	}
	const p = toPath(path);
	const flag = typeof options === "object" && options ? options.flag : undefined;
	if (flag?.includes("x") && existsSync(p)) throw makeError("EEXIST", "open", p, "file already exists");
	const append = flag?.startsWith("a") ?? false;
	call("open", p, () => host.fs.writeFile(p, toBytes(data, encodingOf(options)), append));
	const mode = typeof options === "object" && options ? options.mode : undefined;
	if (mode !== undefined) chmodSync(p, mode);
}

export function appendFileSync(path: PathLike | number, data: string | ArrayBufferView, options?: EncodingOption): void {
	if (typeof path === "number") {
		writeSync(path, toBytes(data, encodingOf(options)));
		return;
	}
	const p = toPath(path);
	call("open", p, () => host.fs.writeFile(p, toBytes(data, encodingOf(options)), true));
}

export function existsSync(path: PathLike): boolean {
	try {
		host.fs.stat(toPath(path), true);
		return true;
	} catch {
		return false;
	}
}

export function accessSync(path: PathLike, mode = constants.F_OK): void {
	const p = toPath(path);
	const stat = call("access", p, () => host.fs.stat(p, true));
	if (mode & constants.X_OK && stat.type === "file" && (stat.mode & 0o111) === 0) {
		throw makeError("EACCES", "access", p, "permission denied");
	}
}

export function statSync(path: PathLike, options?: { throwIfNoEntry?: boolean; bigint?: boolean }): Stats | undefined {
	const p = toPath(path);
	try {
		return new Stats(call("stat", p, () => host.fs.stat(p, true)));
	} catch (error) {
		if (options?.throwIfNoEntry === false && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export function lstatSync(path: PathLike, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
	const p = toPath(path);
	try {
		return new Stats(call("lstat", p, () => host.fs.stat(p, false)));
	} catch (error) {
		if (options?.throwIfNoEntry === false && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export function fstatSync(fd: number): Stats {
	return statSync(fdEntry(fd).path) as Stats;
}

interface ReaddirOptions {
	withFileTypes?: boolean;
	recursive?: boolean;
	encoding?: Encoding;
}

export function readdirSync(path: PathLike, options?: ReaddirOptions | Encoding): (string | Dirent)[] {
	const p = toPath(path);
	const opts = typeof options === "object" && options ? options : {};
	const out: (string | Dirent)[] = [];
	const visit = (dir: string, prefix: string) => {
		const entries = call("scandir", dir, () => host.fs.readdir(dir));
		for (const entry of entries) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			out.push(opts.withFileTypes ? new Dirent(entry.name, entry.type, dir) : rel);
			if (opts.recursive && entry.type === "dir") visit(`${dir}/${entry.name}`, rel);
		}
	};
	visit(p, "");
	return out;
}

export function mkdirSync(path: PathLike, options?: { recursive?: boolean; mode?: number } | number): string | undefined {
	const p = toPath(path);
	const recursive = typeof options === "object" && options?.recursive === true;
	if (recursive) {
		let first: string | undefined;
		let dir = p;
		while (dir && dir !== "/" && !existsSync(dir)) {
			first = dir;
			dir = dir.slice(0, dir.lastIndexOf("/")) || "/";
		}
		call("mkdir", p, () => host.fs.mkdir(p, true));
		return first;
	}
	call("mkdir", p, () => host.fs.mkdir(p, false));
	return undefined;
}

export function mkdtempSync(prefix: string): string {
	return call("mkdtemp", prefix, () => host.fs.mkdtemp(prefix));
}

export function rmSync(path: PathLike, options?: { recursive?: boolean; force?: boolean }): void {
	const p = toPath(path);
	try {
		const stat = call("rm", p, () => host.fs.stat(p, false));
		if (stat.type === "dir" && !options?.recursive) throw makeError("ERR_FS_EISDIR", "rm", p, "is a directory");
		call("rm", p, () => host.fs.rm(p, options?.recursive ?? false));
	} catch (error) {
		if (options?.force && (error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

export function unlinkSync(path: PathLike): void {
	const p = toPath(path);
	const stat = call("unlink", p, () => host.fs.stat(p, false));
	if (stat.type === "dir") throw makeError("EPERM", "unlink", p, "operation not permitted");
	call("unlink", p, () => host.fs.rm(p, false));
}

export function rmdirSync(path: PathLike, options?: { recursive?: boolean }): void {
	const p = toPath(path);
	call("rmdir", p, () => host.fs.rm(p, options?.recursive ?? false));
}

export function renameSync(from: PathLike, to: PathLike): void {
	const a = toPath(from);
	const b = toPath(to);
	call("rename", a, () => host.fs.rename(a, b));
}

export function copyFileSync(from: PathLike, to: PathLike, mode = 0): void {
	const a = toPath(from);
	const b = toPath(to);
	if (mode & constants.COPYFILE_EXCL && existsSync(b)) throw makeError("EEXIST", "copyfile", b, "file already exists");
	call("copyfile", a, () => host.fs.copyFile(a, b));
}

export function cpSync(from: PathLike, to: PathLike, options?: { recursive?: boolean; force?: boolean }): void {
	const a = toPath(from);
	const b = toPath(to);
	const stat = call("cp", a, () => host.fs.stat(a, true));
	if (stat.type !== "dir") {
		if (options?.force === false && existsSync(b)) return;
		copyFileSync(a, b);
		return;
	}
	if (!options?.recursive) throw makeError("ERR_FS_EISDIR", "cp", a, "is a directory");
	mkdirSync(b, { recursive: true });
	for (const entry of host.fs.readdir(a)) cpSync(`${a}/${entry.name}`, `${b}/${entry.name}`, options);
}

export function realpathSync(path: PathLike): string {
	const p = toPath(path);
	return call("realpath", p, () => host.fs.realpath(p));
}
realpathSync.native = realpathSync;

export function symlinkSync(target: PathLike, path: PathLike): void {
	const t = toPath(target);
	const p = toPath(path);
	call("symlink", p, () => host.fs.symlink(t, p));
}

export function linkSync(existing: PathLike, path: PathLike): void {
	copyFileSync(existing, path);
}

export function readlinkSync(path: PathLike): string {
	const p = toPath(path);
	return call("readlink", p, () => host.fs.readlink(p));
}

export function chmodSync(path: PathLike, mode: number | string): void {
	const p = toPath(path);
	call("chmod", p, () => host.fs.chmod(p, typeof mode === "string" ? Number.parseInt(mode, 8) : mode));
}

export function chownSync(): void {}
export function lchownSync(): void {}
export function fchmodSync(fd: number, mode: number): void {
	chmodSync(fdEntry(fd).path, mode);
}

export function utimesSync(path: PathLike, atime: number | Date, mtime: number | Date): void {
	const p = toPath(path);
	const ms = (t: number | Date) => (t instanceof Date ? t.getTime() : t * 1000);
	call("utime", p, () => host.fs.utimes(p, ms(atime), ms(mtime)));
}
export const lutimesSync = utimesSync;
export function futimesSync(fd: number, atime: number | Date, mtime: number | Date): void {
	utimesSync(fdEntry(fd).path, atime, mtime);
}

export function truncateSync(path: PathLike, length = 0): void {
	const p = toPath(path);
	const bytes = host.fs.readFile(p);
	const out = new Uint8Array(length);
	out.set(bytes.subarray(0, length));
	host.fs.writeFile(p, out, false);
}

// ---- file descriptors (emulated: whole-file reads, positional writes) ----

interface FdEntry {
	path: string;
	flags: string;
	position: number;
}

const fds = new Map<number, FdEntry>();
let nextFd = 100;

function fdEntry(fd: number): FdEntry {
	const entry = fds.get(fd);
	if (!entry) throw makeError("EBADF", "fd", String(fd), "bad file descriptor");
	return entry;
}

function normalizeFlags(flags: string | number | undefined): string {
	if (flags === undefined) return "r";
	if (typeof flags === "string") return flags;
	const access = flags & 3;
	if (flags & constants.O_APPEND) return flags & constants.O_EXCL ? "ax" : "a";
	if (access === constants.O_RDONLY) return "r";
	if (flags & constants.O_TRUNC || flags & constants.O_CREAT) return flags & constants.O_EXCL ? "wx" : "w";
	return "r+";
}

export function openSync(path: PathLike, flags?: string | number, mode?: number): number {
	const p = toPath(path);
	const f = normalizeFlags(flags);
	const exists = existsSync(p);
	if (f.includes("x") && exists) throw makeError("EEXIST", "open", p, "file already exists");
	if (f.startsWith("r") && !exists) throw makeError("ENOENT", "open", p, "no such file or directory");
	if (f.startsWith("w")) call("open", p, () => host.fs.writeFile(p, new Uint8Array(0), false));
	if (f.startsWith("a") && !exists) call("open", p, () => host.fs.writeFile(p, new Uint8Array(0), true));
	if (mode !== undefined && !exists) chmodSync(p, mode);
	const fd = nextFd++;
	fds.set(fd, { path: p, flags: f, position: 0 });
	return fd;
}

export function closeSync(fd: number): void {
	fds.delete(fd);
}

export function fsyncSync(): void {}
export function fdatasyncSync(): void {}

export function readSync(
	fd: number,
	buffer: ArrayBufferView,
	offsetOrOptions?: number | { offset?: number; length?: number; position?: number | null },
	length?: number,
	position?: number | null,
): number {
	const entry = fdEntry(fd);
	const opts =
		typeof offsetOrOptions === "object" ? offsetOrOptions : { offset: offsetOrOptions, length, position };
	const target = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const offset = opts.offset ?? 0;
	const len = opts.length ?? target.length - offset;
	const pos = opts.position ?? entry.position;
	const bytes = host.fs.readFile(entry.path);
	const chunk = bytes.subarray(pos, pos + len);
	target.set(chunk, offset);
	if (opts.position == null) entry.position += chunk.length;
	return chunk.length;
}

export function writeSync(
	fd: number,
	data: string | ArrayBufferView,
	offsetOrPosition?: number | null,
	lengthOrEncoding?: number | string,
	position?: number | null,
): number {
	const entry = fdEntry(fd);
	let bytes: Uint8Array;
	let pos: number | null | undefined;
	if (typeof data === "string") {
		bytes = toBytes(data, lengthOrEncoding as Encoding);
		pos = offsetOrPosition;
	} else {
		const all = toBytes(data);
		const offset = offsetOrPosition ?? 0;
		const length = typeof lengthOrEncoding === "number" ? lengthOrEncoding : all.length - offset;
		bytes = all.subarray(offset, offset + length);
		pos = position;
	}
	if (entry.flags.startsWith("a")) {
		host.fs.writeFile(entry.path, bytes, true);
		return bytes.length;
	}
	const at = pos ?? entry.position;
	const current = host.fs.readFile(entry.path);
	if (at === current.length) host.fs.writeFile(entry.path, bytes, true);
	else {
		const out = new Uint8Array(Math.max(current.length, at + bytes.length));
		out.set(current);
		out.set(bytes, at);
		host.fs.writeFile(entry.path, out, false);
	}
	if (pos == null) entry.position = at + bytes.length;
	return bytes.length;
}

export function ftruncateSync(fd: number, length = 0): void {
	truncateSync(fdEntry(fd).path, length);
}

// ---- streams ----

export function createReadStream(
	path: PathLike,
	options?: Encoding | { encoding?: Encoding; start?: number; end?: number; highWaterMark?: number; fd?: number },
): Readable {
	const opts = typeof options === "object" && options ? options : { encoding: options as Encoding };
	const p = opts.fd !== undefined ? fdEntry(opts.fd).path : toPath(path);
	const chunkSize = opts.highWaterMark ?? 64 * 1024;
	let bytes: Uint8Array | undefined;
	let offset = opts.start ?? 0;
	const stream = new Readable({
		read() {
			try {
				bytes ??= call("open", p, () => host.fs.readFile(p));
				const end = Math.min(bytes.length, opts.end !== undefined ? opts.end + 1 : bytes.length);
				if (offset >= end) {
					this.push(null);
					return;
				}
				const next = Math.min(end, offset + chunkSize);
				this.push(toBuffer(bytes.slice(offset, next)));
				offset = next;
			} catch (error) {
				this.destroy(error as Error);
			}
		},
	});
	if (opts.encoding) stream.setEncoding(opts.encoding);
	Object.assign(stream, { path: p, bytesRead: 0, close: (cb?: () => void) => (stream.destroy(), cb?.()) });
	queueMicrotask(() => stream.emit("open", 0));
	return stream;
}

export function createWriteStream(path: PathLike, options?: Encoding | { flags?: string; encoding?: Encoding }): Writable {
	const opts = typeof options === "object" && options ? options : {};
	const p = toPath(path);
	let first = !(opts.flags ?? "w").startsWith("a");
	const stream = new Writable({
		write(chunk: Buffer | string, encoding: string, callback: (error?: Error | null) => void) {
			try {
				const bytes = toBytes(chunk, encoding as Encoding);
				call("open", p, () => host.fs.writeFile(p, bytes, !first));
				first = false;
				callback();
			} catch (error) {
				callback(error as Error);
			}
		},
		final(callback: (error?: Error | null) => void) {
			if (first) {
				try {
					host.fs.writeFile(p, new Uint8Array(0), false);
				} catch (error) {
					callback(error as Error);
					return;
				}
			}
			callback();
		},
	});
	Object.assign(stream, { path: p, bytesWritten: 0, close: (cb?: () => void) => stream.end(cb) });
	queueMicrotask(() => {
		stream.emit("open", 0);
		stream.emit("ready");
	});
	return stream;
}

// ---- glob ----

/** Converts a glob (`*`, `**`, `?`, `{a,b}`, `[...]`) to an anchored RegExp over `/`-separated paths. */
function globToRegExp(pattern: string): RegExp {
	let out = "";
	let braces = 0;
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				const slash = pattern[i + 2] === "/";
				out += slash ? "(?:.*/)?" : ".*";
				i += slash ? 2 : 1;
			} else out += "[^/]*";
		} else if (ch === "?") out += "[^/]";
		else if (ch === "{") {
			braces++;
			out += "(?:";
		} else if (ch === "}" && braces > 0) {
			braces--;
			out += ")";
		} else if (ch === "," && braces > 0) out += "|";
		else if (ch === "[") {
			const end = pattern.indexOf("]", i + 1);
			if (end === -1) out += "\\[";
			else {
				out += `[${pattern.slice(i + 1, end).replace(/^!/, "^")}]`;
				i = end;
			}
		} else out += /[.+^$()|\\]/.test(ch) ? `\\${ch}` : ch;
	}
	return new RegExp(`^${out}$`);
}

export function globSync(
	pattern: string | string[],
	options: { cwd?: string; exclude?: ((path: string) => boolean) | string[]; withFileTypes?: boolean } = {},
): string[] {
	const cwd = options.cwd ?? process.cwd();
	const patterns = (Array.isArray(pattern) ? pattern : [pattern]).map(globToRegExp);
	const excludes = Array.isArray(options.exclude) ? options.exclude.map(globToRegExp) : [];
	const excludeFn = typeof options.exclude === "function" ? options.exclude : undefined;
	const results: string[] = [];
	const visit = (dir: string, prefix: string) => {
		let entries: { name: string; type: HostStat["type"] }[];
		try {
			entries = host.fs.readdir(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (excludes.some((re) => re.test(rel)) || excludeFn?.(rel)) continue;
			if (patterns.some((re) => re.test(rel))) results.push(rel);
			if (entry.type === "dir") visit(`${dir}/${entry.name}`, rel);
		}
	};
	visit(cwd, "");
	return results;
}

// ---- watchers (no file events on the host yet) ----

class FSWatcher extends EventEmitter {
	close(): void {}
	ref(): this {
		return this;
	}
	unref(): this {
		return this;
	}
}

export function watch(): FSWatcher {
	return new FSWatcher();
}

export function watchFile(): FSWatcher {
	return new FSWatcher();
}

export function unwatchFile(): void {}

// ---- callback API ----

type Callback<T> = (error: NodeJS.ErrnoException | null, result?: T) => void;

function callbackify<A extends unknown[], R>(fn: (...args: A) => R) {
	return (...args: unknown[]) => {
		const callback = args.pop() as Callback<R>;
		let result: R;
		try {
			result = fn(...(args as A));
		} catch (error) {
			queueMicrotask(() => callback(error as NodeJS.ErrnoException));
			return;
		}
		queueMicrotask(() => callback(null, result));
	};
}

export const readFile = callbackify(readFileSync);
export const writeFile = callbackify(writeFileSync);
export const appendFile = callbackify(appendFileSync);
export const access = callbackify(accessSync);
export const stat = callbackify(statSync);
export const lstat = callbackify(lstatSync);
export const fstat = callbackify(fstatSync);
export const readdir = callbackify(readdirSync);
export const mkdir = callbackify(mkdirSync);
export const mkdtemp = callbackify(mkdtempSync);
export const rm = callbackify(rmSync);
export const unlink = callbackify(unlinkSync);
export const rmdir = callbackify(rmdirSync);
export const rename = callbackify(renameSync);
export const copyFile = callbackify(copyFileSync);
export const cp = callbackify(cpSync);
export const realpath = Object.assign(callbackify(realpathSync), { native: callbackify(realpathSync) });
export const symlink = callbackify(symlinkSync);
export const link = callbackify(linkSync);
export const readlink = callbackify(readlinkSync);
export const chmod = callbackify(chmodSync);
export const fchmod = callbackify(fchmodSync);
export const chown = callbackify(chownSync);
export const lchown = callbackify(lchownSync);
export const utimes = callbackify(utimesSync);
export const lutimes = callbackify(lutimesSync);
export const futimes = callbackify(futimesSync);
export const truncate = callbackify(truncateSync);
export const ftruncate = callbackify(ftruncateSync);
export const open = callbackify(openSync);
export const close = callbackify(closeSync);
export const fsync = callbackify(fsyncSync);
export const fdatasync = callbackify(fdatasyncSync);

export function read(
	fd: number,
	buffer: ArrayBufferView,
	offset: number,
	length: number,
	position: number | null,
	callback: (error: Error | null, bytesRead?: number, buffer?: ArrayBufferView) => void,
): void {
	try {
		const n = readSync(fd, buffer, offset, length, position);
		queueMicrotask(() => callback(null, n, buffer));
	} catch (error) {
		queueMicrotask(() => callback(error as Error));
	}
}

export function write(fd: number, data: string | ArrayBufferView, ...rest: unknown[]): void {
	const callback = rest.pop() as (error: Error | null, written?: number, data?: unknown) => void;
	try {
		const n = writeSync(fd, data, ...(rest as [number?, number?, number?]));
		queueMicrotask(() => callback(null, n, data));
	} catch (error) {
		queueMicrotask(() => callback(error as Error));
	}
}

export function exists(path: PathLike, callback: (exists: boolean) => void): void {
	const result = existsSync(path);
	queueMicrotask(() => callback(result));
}

// ---- promise API ----

function asyncify<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
	return async (...args: A) => fn(...args);
}

class FileHandle {
	readonly fd: number;

	constructor(fd: number) {
		this.fd = fd;
	}

	async readFile(options?: EncodingOption): Promise<string | Buffer> {
		return readFileSync(this.fd, options);
	}
	async writeFile(data: string | ArrayBufferView, options?: EncodingOption): Promise<void> {
		writeFileSync(this.fd, data, options);
	}
	async appendFile(data: string | ArrayBufferView, options?: EncodingOption): Promise<void> {
		appendFileSync(this.fd, data, options);
	}
	async read(buffer: ArrayBufferView, offset?: number, length?: number, position?: number | null) {
		const bytesRead = readSync(this.fd, buffer, offset, length, position);
		return { bytesRead, buffer };
	}
	async write(data: string | ArrayBufferView, ...rest: [number?, number?, number?]) {
		const bytesWritten = writeSync(this.fd, data, ...rest);
		return { bytesWritten, buffer: data };
	}
	async stat(): Promise<Stats> {
		return fstatSync(this.fd);
	}
	async truncate(length?: number): Promise<void> {
		ftruncateSync(this.fd, length);
	}
	async sync(): Promise<void> {}
	async datasync(): Promise<void> {}
	async chmod(mode: number): Promise<void> {
		fchmodSync(this.fd, mode);
	}
	async close(): Promise<void> {
		closeSync(this.fd);
	}
	createReadStream(options?: { encoding?: Encoding; start?: number; end?: number }): Readable {
		return createReadStream("", { ...options, fd: this.fd });
	}
	async [Symbol.asyncDispose](): Promise<void> {
		closeSync(this.fd);
	}
}

export const promises = {
	readFile: asyncify(readFileSync),
	writeFile: asyncify(writeFileSync),
	appendFile: asyncify(appendFileSync),
	access: asyncify(accessSync),
	stat: asyncify(statSync),
	lstat: asyncify(lstatSync),
	readdir: asyncify(readdirSync),
	mkdir: asyncify(mkdirSync),
	mkdtemp: asyncify(mkdtempSync),
	rm: asyncify(rmSync),
	unlink: asyncify(unlinkSync),
	rmdir: asyncify(rmdirSync),
	rename: asyncify(renameSync),
	copyFile: asyncify(copyFileSync),
	cp: asyncify(cpSync),
	realpath: asyncify(realpathSync),
	symlink: asyncify(symlinkSync),
	link: asyncify(linkSync),
	readlink: asyncify(readlinkSync),
	chmod: asyncify(chmodSync),
	chown: asyncify(chownSync),
	lchown: asyncify(lchownSync),
	utimes: asyncify(utimesSync),
	lutimes: asyncify(lutimesSync),
	truncate: asyncify(truncateSync),
	open: async (path: PathLike, flags?: string | number, mode?: number) => new FileHandle(openSync(path, flags, mode)),
	opendir: async (path: PathLike) => {
		const entries = readdirSync(path, { withFileTypes: true }) as Dirent[];
		return {
			path: toPath(path),
			async *[Symbol.asyncIterator]() {
				yield* entries;
			},
			async read() {
				return entries.shift() ?? null;
			},
			async close() {},
		};
	},
	watch: async function* () {},
	constants,
};

export default {
	constants,
	F_OK,
	R_OK,
	W_OK,
	X_OK,
	Stats,
	Dirent,
	readFileSync,
	writeFileSync,
	appendFileSync,
	existsSync,
	accessSync,
	statSync,
	lstatSync,
	fstatSync,
	readdirSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	unlinkSync,
	rmdirSync,
	renameSync,
	copyFileSync,
	cpSync,
	realpathSync,
	symlinkSync,
	linkSync,
	readlinkSync,
	chmodSync,
	chownSync,
	lchownSync,
	fchmodSync,
	utimesSync,
	lutimesSync,
	futimesSync,
	truncateSync,
	openSync,
	closeSync,
	fsyncSync,
	fdatasyncSync,
	readSync,
	writeSync,
	ftruncateSync,
	createReadStream,
	createWriteStream,
	globSync,
	watch,
	watchFile,
	unwatchFile,
	readFile,
	writeFile,
	appendFile,
	access,
	stat,
	lstat,
	fstat,
	readdir,
	mkdir,
	mkdtemp,
	rm,
	unlink,
	rmdir,
	rename,
	copyFile,
	cp,
	realpath,
	symlink,
	link,
	readlink,
	chmod,
	fchmod,
	chown,
	lchown,
	utimes,
	lutimes,
	futimes,
	truncate,
	ftruncate,
	open,
	close,
	fsync,
	fdatasync,
	read,
	write,
	exists,
	promises,
};
