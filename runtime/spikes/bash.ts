// Spike: just-bash (a bash interpreter in TypeScript) over a real directory, in JavaScriptCore.
// Run: node spikes/build-spike.mjs bash && pico-cli --bundle dist --script dist/bash-spike.js --cwd <dir>
import { Bash, ReadWriteFs } from "just-bash";

const log = (...args: unknown[]) => globalThis.__pico.log("log", args.map(String).join(" "));

const scripts = [
	"pwd && ls -la",
	"echo 'hello world' > a.txt && cat a.txt | tr a-z A-Z",
	"for i in 1 2 3; do echo line $i >> b.txt; done; wc -l b.txt",
	"mkdir -p src/lib && printf 'export const x = 1;\\nfunction foo() {}\\n' > src/lib/x.ts && grep -rn 'foo' src",
	"find . -name '*.ts' | xargs wc -l",
	"rg -n export src",
	"sed -i 's/x = 1/x = 2/' src/lib/x.ts && cat src/lib/x.ts",
	"echo '{\"a\":[1,2,3]}' | jq '.a | add'",
	"if [ -f a.txt ]; then echo exists; else echo missing; fi",
	"awk '{print $2}' b.txt | sort -r | head -2",
	"cat missing.txt; echo exit=$?",
	"tar czf out.tgz a.txt b.txt && tar tzf out.tgz",
	"curl -s https://httpbin.org/get | jq -r .url",
	"date +%Y && seq 3 | paste -sd+ | bc 2>/dev/null || echo no-bc",
];

async function main(): Promise<void> {
	const root = process.cwd();
	const started = performance.now();
	const bash = new Bash({
		fs: new ReadWriteFs({ root }),
		cwd: "/",
		network: { dangerouslyAllowFullInternetAccess: true },
		defenseInDepth: false,
	});
	log(`created in ${Math.round(performance.now() - started)} ms`);
	for (const script of scripts) {
		const t0 = performance.now();
		try {
			const result = await bash.exec(script);
			log(`$ ${script}\n${result.stdout}${result.stderr ? `[stderr] ${result.stderr}` : ""}[exit ${result.exitCode}, ${Math.round(performance.now() - t0)} ms]`);
		} catch (error) {
			log(`$ ${script}\n[threw] ${(error as Error).stack ?? error}`);
		}
	}
	process.exit(0);
}

main().catch((error: unknown) => {
	globalThis.__pico.log("error", `spike failed: ${(error as Error)?.stack ?? error}`);
	process.exit(2);
});
