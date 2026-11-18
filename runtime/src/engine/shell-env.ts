// pico's execution environment: durable's file operations (NodeExecutionEnv over pico's fs), with `exec()` running in
// just-bash, a bash interpreter in TypeScript. iOS has no fork/exec, so commands (ls, grep, sed, awk, find, rg, jq,
// curl, ...) run in-process over the real file system. Paths are real paths, the same ones the file tools see.
import type { Context } from "@earendil-works/chord/context";
import {
	err,
	ExecutionError,
	ok,
	type Result,
	type ShellExecOptions,
	type ShellExecResult,
} from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Bash, getCommandNames, type IFileSystem, ReadWriteFs } from "just-bash";

/** Longest command the shell runs before it is stopped, as in durable's NodeExecutionEnv. */
const MAX_TIMEOUT_SECONDS = 3600;

/**
 * The whole file system the app may see (the iOS sandbox decides what is reachable), plus just-bash's commands as
 * executables in /bin and /usr/bin. just-bash finds commands by looking for files on $PATH; iOS has /usr/bin but
 * none of these commands in it, so lookups would fail without the stand-ins.
 */
const commands = new Set<string>(getCommandNames());

function commandPath(path: string): boolean {
	const match = /^\/(?:usr\/)?bin\/([^/]+)$/.exec(path);
	return match !== null && commands.has(match[1]);
}

const executableStat = {
	isFile: true,
	isDirectory: false,
	isSymbolicLink: false,
	mode: 0o100755,
	size: 0,
	mtime: new Date(0),
};

// allowSymlinks: on iOS every app path goes through /var, a symlink to /private/var.
const realFs = new ReadWriteFs({ root: "/", allowSymlinks: true });
const rootFs: IFileSystem = new Proxy(realFs, {
	get(target, key, receiver) {
		if (key === "exists") return async (path: string) => commandPath(path) || target.exists(path);
		if (key === "stat" || key === "lstat") {
			return async (path: string) => (commandPath(path) ? executableStat : target[key](path));
		}
		const value = Reflect.get(target, key, receiver);
		return typeof value === "function" ? value.bind(target) : value;
	},
});

function quote(arg: string): string {
	return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export class PicoExecutionEnv extends NodeExecutionEnv {
	private readonly running = new Set<AbortController>();
	private readonly bashEnv: Record<string, string>;

	constructor(options: { cwd: string; env?: Record<string, string> }) {
		super({ cwd: options.cwd });
		this.bashEnv = options.env ?? {};
	}

	override async exec(
		command: string | readonly string[],
		options: ShellExecOptions | undefined,
		context: Context,
	): Promise<Result<ShellExecResult, ExecutionError>> {
		const signal = context.abortSignal;
		if (signal?.aborted) return err(new ExecutionError("aborted", "aborted"));
		const timeout = options?.timeout;
		if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS)) {
			return err(new ExecutionError("timeout", `Invalid timeout: must be 1 to ${MAX_TIMEOUT_SECONDS} seconds`));
		}
		const cwd = options?.cwd ? (options.cwd.startsWith("/") ? options.cwd : `${this.cwd}/${options.cwd}`) : this.cwd;
		const script = typeof command === "string" ? command : command.map(quote).join(" ");

		const controller = new AbortController();
		this.running.add(controller);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		let timedOut = false;
		const timer =
			timeout === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						controller.abort();
					}, timeout * 1000);

		try {
			const env: Record<string, string> = {
				HOME: process.env.HOME ?? "/",
				USER: "mobile",
				PWD: cwd,
				...(options?.inheritEnv === false ? {} : this.bashEnv),
				...(options?.env ?? {}),
			};
			const bash = new Bash({
				fs: rootFs,
				cwd,
				env,
				network: { dangerouslyAllowFullInternetAccess: true },
				// Hardening for untrusted guests in a shared server process; here the user's agent runs on the user's device.
				defenseInDepth: false,
			});
			const result = await bash.exec(script, { signal: controller.signal });
			if (timedOut) return err(new ExecutionError("timeout", `timeout:${timeout}`));
			if (signal?.aborted) return err(new ExecutionError("aborted", "aborted"));
			// just-bash returns output when the script ends; deliver it as two chunks.
			if (result.stdout) options?.onOutput?.(result.stdout, context, { stream: "stdout" });
			if (result.stderr) options?.onOutput?.(result.stderr, context, { stream: "stderr" });
			return ok({ exitCode: result.exitCode });
		} catch (error) {
			if (timedOut) return err(new ExecutionError("timeout", `timeout:${timeout}`));
			if (signal?.aborted || controller.signal.aborted) return err(new ExecutionError("aborted", "aborted"));
			return err(new ExecutionError("unknown", (error as Error).message ?? String(error), error as Error));
		} finally {
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			this.running.delete(controller);
		}
	}

	override async cleanup(context: Context): Promise<void> {
		for (const controller of this.running) controller.abort();
		this.running.clear();
		await super.cleanup(context);
	}
}
