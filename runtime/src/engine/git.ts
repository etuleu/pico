// `git` for pico's shell: the common porcelain commands on isomorphic-git (pure JS), over the real file system and
// fetch. Repositories are normal `.git` directories, compatible with git everywhere else.
// Auth for HTTPS remotes: GITHUB_TOKEN or GIT_TOKEN (stored in the Keychain by the app).
import * as fs from "node:fs";
import { join, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { defineCommand, type ExecResult } from "just-bash";

type Env = Record<string, string | undefined>;

interface Io {
	out: string[];
	err: string[];
}

class UsageError extends Error {}

function result(io: Io, exitCode: number): ExecResult {
	return { stdout: io.out.join(""), stderr: io.err.join(""), exitCode };
}

function envOf(ctx: { env: Map<string, string> | Record<string, string> }): Env {
	return ctx.env instanceof Map ? Object.fromEntries(ctx.env) : ctx.env;
}

/** Parses `-x value`, `--x=value`, `--x value` and flags; everything else is positional. */
function parse(args: string[], valued: string[]): { flags: Map<string, string | true>; rest: string[] } {
	const flags = new Map<string, string | true>();
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			rest.push(...args.slice(i + 1));
			break;
		}
		if (arg.startsWith("--") && arg.includes("=")) {
			const [key, value] = arg.slice(2).split(/=(.*)/s);
			flags.set(key, value);
		} else if (arg.startsWith("-") && arg.length > 1) {
			const key = arg.replace(/^--?/, "");
			if (valued.includes(key) && i + 1 < args.length) flags.set(key, args[++i]);
			else flags.set(key, true);
		} else rest.push(arg);
	}
	return { flags, rest };
}

async function findRoot(cwd: string): Promise<string> {
	try {
		return await git.findRoot({ fs, filepath: cwd });
	} catch {
		throw new UsageError("fatal: not a git repository (or any of the parent directories): .git");
	}
}

function auth(env: Env) {
	const token = env.GITHUB_TOKEN || env.GIT_TOKEN || process.env.GITHUB_TOKEN || process.env.GIT_TOKEN;
	return token ? () => ({ username: "x-access-token", password: token }) : undefined;
}

async function author(dir: string, env: Env) {
	const name = env.GIT_AUTHOR_NAME || (await git.getConfig({ fs, dir, path: "user.name" })) || process.env.GIT_AUTHOR_NAME || "pico";
	const email =
		env.GIT_AUTHOR_EMAIL || (await git.getConfig({ fs, dir, path: "user.email" })) || process.env.GIT_AUTHOR_EMAIL || "pico@localhost";
	return { name: String(name), email: String(email) };
}

const progress = (io: Io) => (event: { phase: string; loaded: number; total?: number }) => {
	if (event.total && event.loaded === event.total) io.err.push(`${event.phase}: 100% (${event.total}/${event.total}), done.\n`);
};

/** `git status` codes from isomorphic-git's status matrix: [file, head, workdir, stage]. */
function shortStatus(head: number, workdir: number, stage: number): string {
	const index = head === 0 && stage !== 0 ? "A" : stage === 0 && head === 1 ? "D" : stage !== head && stage !== 0 ? "M" : " ";
	const work = workdir === 0 && stage !== 0 ? "D" : workdir === 2 && stage !== workdir ? "M" : " ";
	if (head === 0 && workdir === 2 && stage === 0) return "??";
	return `${index === " " && head === 1 && stage === 3 ? "M" : index}${work}`;
}

async function readHeadFile(dir: string, filepath: string): Promise<string> {
	try {
		const oid = await git.resolveRef({ fs, dir, ref: "HEAD" });
		const { blob } = await git.readBlob({ fs, dir, oid, filepath });
		return new TextDecoder().decode(blob);
	} catch {
		return "";
	}
}

async function run(args: string[], cwd: string, env: Env, io: Io): Promise<number> {
	const [command, ...rest] = args;
	switch (command) {
		case undefined:
		case "help":
		case "--help":
			io.out.push(
				"usage: git <command>\n\ncommands: init clone status add rm commit log diff branch checkout switch remote fetch pull push ls-remote config rev-parse show-ref\n(pico: isomorphic-git; auth via GITHUB_TOKEN)\n",
			);
			return 0;
		case "--version":
		case "version":
			io.out.push(`git version isomorphic-git ${git.version()} (pico)\n`);
			return 0;
		case "init": {
			const { flags, rest: positional } = parse(rest, ["b", "initial-branch"]);
			const dir = resolve(cwd, positional[0] ?? ".");
			await git.init({ fs, dir, defaultBranch: String(flags.get("b") ?? flags.get("initial-branch") ?? "main") });
			io.out.push(`Initialized empty Git repository in ${join(dir, ".git")}/\n`);
			return 0;
		}
		case "clone": {
			const { flags, rest: positional } = parse(rest, ["depth", "b", "branch"]);
			const url = positional[0];
			if (!url) throw new UsageError("usage: git clone <url> [<dir>]");
			const name = url.replace(/\/$/, "").split("/").pop()?.replace(/\.git$/, "") ?? "repo";
			const dir = resolve(cwd, positional[1] ?? name);
			io.err.push(`Cloning into '${relative(cwd, dir) || "."}'...\n`);
			await git.clone({
				fs,
				http,
				dir,
				url,
				ref: (flags.get("b") ?? flags.get("branch")) as string | undefined,
				singleBranch: flags.has("single-branch") || flags.has("depth"),
				depth: flags.has("depth") ? Number(flags.get("depth")) : undefined,
				onAuth: auth(env),
				onProgress: progress(io),
			});
			return 0;
		}
		case "status": {
			const dir = await findRoot(cwd);
			const { flags } = parse(rest, []);
			const matrix = await git.statusMatrix({ fs, dir });
			const changed = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
			const short = flags.has("s") || flags.has("short") || flags.has("porcelain");
			if (!short) {
				const branch = (await git.currentBranch({ fs, dir })) ?? "HEAD (detached)";
				io.out.push(`On branch ${branch}\n`);
				if (changed.length === 0) {
					io.out.push("nothing to commit, working tree clean\n");
					return 0;
				}
			}
			for (const [file, head, workdir, stage] of changed) io.out.push(`${shortStatus(head, workdir, stage)} ${file}\n`);
			return 0;
		}
		case "add": {
			const dir = await findRoot(cwd);
			const { flags, rest: paths } = parse(rest, []);
			const all = flags.has("A") || flags.has("all") || paths.includes(".");
			const matrix = await git.statusMatrix({ fs, dir });
			for (const [file, head, workdir, stage] of matrix) {
				const abs = join(dir, file);
				const selected =
					all || paths.some((p) => abs === resolve(cwd, p) || abs.startsWith(`${resolve(cwd, p)}/`));
				if (!selected || (head === 1 && workdir === 1 && stage === 1)) continue;
				if (workdir === 0) await git.remove({ fs, dir, filepath: file });
				else await git.add({ fs, dir, filepath: file });
			}
			return 0;
		}
		case "rm": {
			const dir = await findRoot(cwd);
			const { flags, rest: paths } = parse(rest, []);
			for (const p of paths) {
				const filepath = relative(dir, resolve(cwd, p));
				await git.remove({ fs, dir, filepath });
				if (!flags.has("cached")) fs.rmSync(join(dir, filepath), { force: true });
				io.out.push(`rm '${filepath}'\n`);
			}
			return 0;
		}
		case "commit": {
			const dir = await findRoot(cwd);
			const { flags } = parse(rest, ["m", "message"]);
			const message = flags.get("m") ?? flags.get("message");
			if (typeof message !== "string") throw new UsageError("pico git: commit needs -m <message>");
			if (flags.has("a") || flags.has("all") || flags.has("am")) {
				for (const [file, head, workdir] of await git.statusMatrix({ fs, dir })) {
					if (head === 0) continue;
					if (workdir === 0) await git.remove({ fs, dir, filepath: file });
					else if (workdir === 2) await git.add({ fs, dir, filepath: file });
				}
			}
			const sig = await author(dir, env);
			const oid = await git.commit({ fs, dir, message, author: sig });
			const branch = (await git.currentBranch({ fs, dir })) ?? "HEAD";
			io.out.push(`[${branch} ${oid.slice(0, 7)}] ${message.split("\n")[0]}\n`);
			return 0;
		}
		case "log": {
			const dir = await findRoot(cwd);
			const { flags } = parse(rest, ["n", "max-count"]);
			const n = flags.get("n") ?? flags.get("max-count");
			const depth = typeof n === "string" ? Number(n) : (rest.find((a) => /^-\d+$/.test(a))?.slice(1) ?? undefined);
			const commits = await git.log({ fs, dir, depth: depth === undefined ? undefined : Number(depth) });
			for (const { oid, commit } of commits) {
				if (flags.has("oneline")) {
					io.out.push(`${oid.slice(0, 7)} ${commit.message.split("\n")[0]}\n`);
					continue;
				}
				const date = new Date(commit.author.timestamp * 1000).toUTCString();
				io.out.push(`commit ${oid}\nAuthor: ${commit.author.name} <${commit.author.email}>\nDate:   ${date}\n\n`);
				io.out.push(`${commit.message.trimEnd().replace(/^/gm, "    ")}\n\n`);
			}
			return 0;
		}
		case "diff": {
			// Working tree against HEAD (pico does not separate staged changes in diffs).
			const dir = await findRoot(cwd);
			const { flags, rest: paths } = parse(rest, []);
			const matrix = await git.statusMatrix({ fs, dir });
			for (const [file, head, workdir] of matrix) {
				if (head === 1 && workdir === 1) continue;
				if (head === 0 && !flags.has("cached") && !flags.has("staged")) {
					// Untracked files are not shown by git diff.
					const stage = matrix.find(([f]) => f === file)?.[3] ?? 0;
					if (stage === 0) continue;
				}
				const abs = join(dir, file);
				if (paths.length && !paths.some((p) => abs === resolve(cwd, p) || abs.startsWith(`${resolve(cwd, p)}/`))) continue;
				const before = head === 1 ? await readHeadFile(dir, file) : "";
				const after = workdir === 0 ? "" : (fs.readFileSync(abs, "utf8") as string);
				if (flags.has("stat") || flags.has("name-only")) {
					io.out.push(`${file}\n`);
					continue;
				}
				io.out.push(`diff --git a/${file} b/${file}\n`);
				io.out.push(
					createTwoFilesPatch(head === 1 ? `a/${file}` : "/dev/null", workdir === 0 ? "/dev/null" : `b/${file}`, before, after, "", "", {
						context: 3,
					})
						.split("\n")
						.slice(1) // the "=====" separator line
						.map((line) => (line.startsWith("--- ") || line.startsWith("+++ ") ? line.replace(/\t$/, "") : line))
						.join("\n"),
				);
			}
			return 0;
		}
		case "branch": {
			const dir = await findRoot(cwd);
			const { flags, rest: positional } = parse(rest, []);
			if (flags.has("d") || flags.has("D") || flags.has("delete")) {
				for (const ref of positional) await git.deleteBranch({ fs, dir, ref });
				return 0;
			}
			if (positional[0]) {
				await git.branch({ fs, dir, ref: positional[0] });
				return 0;
			}
			const current = await git.currentBranch({ fs, dir });
			for (const branch of await git.listBranches({ fs, dir })) io.out.push(`${branch === current ? "*" : " "} ${branch}\n`);
			if (flags.has("a") || flags.has("r")) {
				for (const remote of await git.listRemotes({ fs, dir })) {
					for (const branch of await git.listBranches({ fs, dir, remote: remote.remote })) {
						io.out.push(`  remotes/${remote.remote}/${branch}\n`);
					}
				}
			}
			return 0;
		}
		case "checkout":
		case "switch": {
			const dir = await findRoot(cwd);
			const { flags, rest: positional } = parse(rest, ["b", "c"]);
			const create = flags.get("b") ?? flags.get("c");
			if (typeof create === "string") {
				await git.branch({ fs, dir, ref: create, checkout: true });
				io.err.push(`Switched to a new branch '${create}'\n`);
				return 0;
			}
			const target = positional[0];
			if (!target) throw new UsageError(`usage: git ${command} <branch>`);
			if (command === "checkout" && positional.length > 0 && (target === "--" || fs.existsSync(resolve(cwd, target)))) {
				// `git checkout -- <file>`: restore files from HEAD.
				const files = positional.filter((p) => p !== "--").map((p) => relative(dir, resolve(cwd, p)));
				await git.checkout({ fs, dir, filepaths: files, force: true });
				return 0;
			}
			await git.checkout({ fs, dir, ref: target });
			io.err.push(`Switched to branch '${target}'\n`);
			return 0;
		}
		case "remote": {
			const dir = await findRoot(cwd);
			const [sub, name, url] = rest;
			if (sub === "add" && name && url) {
				await git.addRemote({ fs, dir, remote: name, url });
				return 0;
			}
			if ((sub === "remove" || sub === "rm") && name) {
				await git.deleteRemote({ fs, dir, remote: name });
				return 0;
			}
			if (sub === "set-url" && name && url) {
				await git.addRemote({ fs, dir, remote: name, url, force: true });
				return 0;
			}
			for (const remote of await git.listRemotes({ fs, dir })) {
				if (sub === "-v") io.out.push(`${remote.remote}\t${remote.url} (fetch)\n${remote.remote}\t${remote.url} (push)\n`);
				else io.out.push(`${remote.remote}\n`);
			}
			return 0;
		}
		case "fetch": {
			const dir = await findRoot(cwd);
			const remote = rest.find((a) => !a.startsWith("-")) ?? "origin";
			const res = await git.fetch({ fs, http, dir, remote, onAuth: auth(env), onProgress: progress(io) });
			io.err.push(`From ${(await git.getConfig({ fs, dir, path: `remote.${remote}.url` })) ?? remote}\n`);
			if (res.fetchHead) io.err.push(`   ${res.fetchHead.slice(0, 7)}  ${res.fetchHeadDescription ?? ""}\n`);
			return 0;
		}
		case "pull": {
			const dir = await findRoot(cwd);
			const positional = rest.filter((a) => !a.startsWith("-"));
			await git.pull({
				fs,
				http,
				dir,
				remote: positional[0] ?? "origin",
				ref: positional[1],
				singleBranch: true,
				author: await author(dir, env),
				onAuth: auth(env),
				onProgress: progress(io),
			});
			io.out.push("Updated.\n");
			return 0;
		}
		case "push": {
			const dir = await findRoot(cwd);
			const { flags, rest: positional } = parse(rest, []);
			const remote = positional[0] ?? "origin";
			const ref = positional[1] ?? (await git.currentBranch({ fs, dir })) ?? undefined;
			const res = await git.push({
				fs,
				http,
				dir,
				remote,
				ref,
				force: flags.has("f") || flags.has("force"),
				onAuth: auth(env),
				onProgress: progress(io),
			});
			if (!res.ok) {
				io.err.push(`error: failed to push: ${res.error ?? JSON.stringify(res.refs)}\n`);
				return 1;
			}
			if (flags.has("u") || flags.has("set-upstream")) {
				await git.setConfig({ fs, dir, path: `branch.${ref}.remote`, value: remote });
				await git.setConfig({ fs, dir, path: `branch.${ref}.merge`, value: `refs/heads/${ref}` });
			}
			io.err.push(`To ${(await git.getConfig({ fs, dir, path: `remote.${remote}.url` })) ?? remote}\n   ${ref} -> ${ref}\n`);
			return 0;
		}
		case "config": {
			const dir = await findRoot(cwd).catch(() => undefined);
			const positional = rest.filter((a) => !a.startsWith("--"));
			if (!dir) throw new UsageError("pico git: config works inside a repository (no global config yet)");
			const [path, value] = positional;
			if (!path) throw new UsageError("usage: git config <key> [<value>]");
			if (value === undefined) {
				const current = await git.getConfig({ fs, dir, path });
				if (current === undefined) return 1;
				io.out.push(`${current}\n`);
				return 0;
			}
			await git.setConfig({ fs, dir, path, value });
			return 0;
		}
		case "rev-parse": {
			if (rest.includes("--show-toplevel")) {
				io.out.push(`${await findRoot(cwd)}\n`);
				return 0;
			}
			if (rest.includes("--is-inside-work-tree")) {
				io.out.push(`${await findRoot(cwd).then(() => "true")}\n`);
				return 0;
			}
			const dir = await findRoot(cwd);
			const ref = rest.find((a) => !a.startsWith("-")) ?? "HEAD";
			if (rest.includes("--abbrev-ref")) {
				io.out.push(`${(await git.currentBranch({ fs, dir })) ?? "HEAD"}\n`);
				return 0;
			}
			const oid = await git.resolveRef({ fs, dir, ref });
			io.out.push(`${rest.includes("--short") ? oid.slice(0, 7) : oid}\n`);
			return 0;
		}
		case "ls-remote": {
			const positional = rest.filter((a) => !a.startsWith("-"));
			let url = positional[0] ?? "origin";
			if (!/^https?:\/\//.test(url)) {
				const dir = await findRoot(cwd);
				url = String((await git.getConfig({ fs, dir, path: `remote.${url}.url` })) ?? url);
			}
			const refs = await git.listServerRefs({ http, url, onAuth: auth(env), symrefs: true, peelTags: true });
			const tagsOnly = rest.includes("--tags") || rest.includes("-t");
			const headsOnly = rest.includes("--heads") || rest.includes("-h");
			for (const ref of refs) {
				if (tagsOnly && !ref.ref.startsWith("refs/tags/")) continue;
				if (headsOnly && !ref.ref.startsWith("refs/heads/")) continue;
				io.out.push(`${ref.oid}\t${ref.ref}\n`);
				if (ref.peeled) io.out.push(`${ref.peeled}\t${ref.ref}^{}\n`);
			}
			return 0;
		}
		case "show-ref": {
			const dir = await findRoot(cwd);
			for (const branch of await git.listBranches({ fs, dir })) {
				io.out.push(`${await git.resolveRef({ fs, dir, ref: branch })} refs/heads/${branch}\n`);
			}
			return 0;
		}
		default:
			throw new UsageError(`git: '${command}' is not supported by pico's git (isomorphic-git). See 'git help'.`);
	}
}

export const gitCommand = defineCommand("git", async (args, ctx) => {
	const io: Io = { out: [], err: [] };
	// `git -C <dir> ...`
	let cwd = ctx.cwd;
	while (args[0] === "-C" && args[1]) {
		cwd = resolve(cwd, args[1]);
		args = args.slice(2);
	}
	try {
		return result(io, await run(args, cwd, envOf(ctx), io));
	} catch (error) {
		const message = (error as Error).message ?? String(error);
		io.err.push(error instanceof UsageError ? `${message}\n` : `fatal: ${message}\n`);
		return result(io, error instanceof UsageError ? 129 : 128);
	}
});
