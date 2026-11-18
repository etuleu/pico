// Spike: which recursive grep flag combinations work in just-bash.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PicoExecutionEnv } from "../src/engine/shell-env.ts";

const scripts = [
	"grep -rl Spoon .", "grep -Rl Spoon .", "grep -rIl Spoon .", "grep -RIl Spoon .", "grep -RIl -- 'Spoon' .",
	"grep -RIniE 'spoon' .", "grep -rn Spoon .", "rg -l Spoon .", "grep -I Spoon s/store/main.jsonl | head -c 80",
];

async function main(): Promise<void> {
	const env = new PicoExecutionEnv({ cwd: process.cwd() });
	for (const script of scripts) {
		let out = "";
		const r = await env.exec(script, { onOutput: (t) => (out += t) }, BACKGROUND_CONTEXT);
		globalThis.__pico.log("log", `$ ${script}  ->  exit ${r.ok ? r.value.exitCode : r.error.message}  ${JSON.stringify(out.slice(0, 120))}`);
	}
	process.exit(0);
}
main();
