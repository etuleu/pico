// pico's coding extension: pi's system prompt structure (preamble, tools, rules, project context, cwd) as durable
// prompt sections. Project context follows pi: AGENTS.md / CLAUDE.md in the agent dir and every ancestor of cwd.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";

const contextFileNames = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function contextFileIn(dir: string): { path: string; content: string } | undefined {
	for (const name of contextFileNames) {
		const path = join(dir, name);
		try {
			if (existsSync(path) && statSync(path)?.isFile()) {
				return { path, content: (readFileSync(path, "utf8") as string).replace(/^\uFEFF/, "") };
			}
		} catch {
			// Unreadable context files are skipped, as in pi.
		}
	}
	return undefined;
}

/** The agent dir's context file first, then the cwd's ancestors from the root down. */
export function loadContextFiles(cwd: string, agentDir: string): { path: string; content: string }[] {
	const files: { path: string; content: string }[] = [];
	const seen = new Set<string>();
	const global = contextFileIn(agentDir);
	if (global) {
		files.push(global);
		seen.add(global.path);
	}
	const ancestors: { path: string; content: string }[] = [];
	let dir = cwd;
	while (true) {
		const file = contextFileIn(dir);
		if (file && !seen.has(file.path)) {
			ancestors.unshift(file);
			seen.add(file.path);
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return [...files, ...ancestors];
}

const toolSnippets: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, grep, find, etc.)",
	edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
	write: "Create or overwrite files",
};

export function createCodingExtension(options: { agentDir: string; platform: string }) {
	return defineExtension({
		name: "pico-coding",
		sections: [
			section(
				"preamble",
				() =>
					`You are a coding assistant running inside pico, the pi coding agent on ${options.platform}. Help users inspect files, run commands, and modify code.`,
				{ tag: false },
			),
			section("tools", (input) => {
				const names = input.agent.tools.map((tool) => tool.name);
				const lines = names.filter((name) => toolSnippets[name]).map((name) => `- ${name}: ${toolSnippets[name]}`);
				return `${lines.length ? lines.join("\n") : "(none)"}\n\nAdditional tools may be available.`;
			}),
			section("rules", (input) => {
				const names = input.agent.tools.map((tool) => tool.name);
				const rules: string[] = [];
				if (names.includes("bash")) rules.push("Use bash for file operations like ls, rg, find");
				rules.push("Be concise in your responses", "Show file paths clearly when working with files");
				return rules.map((rule) => `- ${rule}`).join("\n");
			}),
			section("environment", (input) => {
				if (!input.agent.tools.some((tool) => tool.name === "bash")) return undefined;
				return [
					"The bash tool runs in pico's built-in shell (a bash interpreter, not a full Unix system).",
					"Available: bash syntax (pipes, redirects, &&, if/for/while, functions) and common commands such as ls, cat, cp, mv, rm, mkdir, find, grep, rg, sed, awk, sort, uniq, wc, head, tail, cut, tr, xargs, diff, jq, yq, curl, base64, sha256sum, tar, gzip, date, sleep.",
					"git is available (init, clone, status, add, rm, commit, log, diff, branch, checkout, switch, remote, fetch, pull, push, config, rev-parse); HTTPS remotes use the user's GitHub token.",
					"Not available: package managers, compilers, node, python, ssh, sudo. Do not try to install them.",
					"Write files in the working directory or under $TMPDIR; /tmp and system folders are not writable.",
					"Past pico chat sessions are in ~/.pi/pico/sessions/<id>/ (meta.json has the title; store/*.jsonl holds the transcript); search them when the user refers to earlier chats.",
				].join("\n");
			}),
			section("project_context", (input) => {
				const files = loadContextFiles(input.env?.cwd ?? input.agent.cwd ?? "/", options.agentDir);
				if (files.length === 0) return undefined;
				return [
					"Project-specific instructions and guidelines:",
					...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
				].join("\n\n");
			}),
			section("cwd", (input) => input.env?.cwd),
		],
	});
}
