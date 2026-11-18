// Spike: `git` (isomorphic-git) inside pico's shell environment, in JavaScriptCore.
// Run: node spikes/build-spike.mjs git && pico-cli --bundle dist --script dist/git-spike.js --cwd <empty dir>
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PicoExecutionEnv } from "../src/engine/shell-env.ts";

const log = (...args: unknown[]) => globalThis.__pico.log("log", args.map(String).join(" "));

const scripts = [
	"git init repo && cd repo && git config user.name Pico && git config user.email pico@example.com && echo hello > a.txt && git add . && git commit -m 'first commit' && git log --oneline",
	"cd repo && echo world >> a.txt && echo new > b.txt && git status && git status -s",
	"cd repo && git diff",
	"cd repo && git add -A && git commit -m 'second' && git log && git checkout -b feature && git branch",
	"time git clone --depth 1 https://github.com/octocat/Hello-World.git hw && cd hw && git log --oneline -n 3 && ls -la && git remote -v",
];

async function main(): Promise<void> {
	const env = new PicoExecutionEnv({ cwd: process.cwd() });
	for (const script of scripts) {
		const t0 = performance.now();
		let output = "";
		const result = await env.exec(script, { onOutput: (text) => (output += text) }, BACKGROUND_CONTEXT);
		log(`$ ${script}\n${output}[${result.ok ? `exit ${result.value.exitCode}` : `error ${result.error.message}`}, ${Math.round(performance.now() - t0)} ms]`);
	}
	process.exit(0);
}

main().catch((error: unknown) => {
	globalThis.__pico.log("error", `spike failed: ${(error as Error)?.stack ?? error}`);
	process.exit(2);
});
