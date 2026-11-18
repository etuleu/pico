// Builds the pico runtime into dist/:
//   prelude.js   globals JavaScriptCore lacks (always)
//   engine.js    pico engine on pi-durable (default)
//   smoke.js     runtime smoke test (default)
//   pi.js, pkg/  pi coding-agent in RPC mode, the M0 fallback (only with --pi)
// Usage: node build.mjs [--pi]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { picoShims } from "./shims.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
const withPi = process.argv.includes("--pi");
const shimPlugin = picoShims(root);

const common = {
	bundle: true,
	format: "iife",
	platform: "neutral",
	target: "safari18",
	mainFields: ["module", "main"],
	// `source` makes pi-durable and Chord bundle from src/ (they export it); pi-ai only ships dist/.
	conditions: ["source", "node", "import", "default"],
	nodePaths: [join(root, "../vendor/pi/node_modules")],
	logLevel: "warning",
	sourcemap: "linked",
	legalComments: "none",
	loader: { ".node": "empty", ".wasm": "file" },
	metafile: true,
};

const importMeta = (file) => ({
	"import.meta.url": JSON.stringify(`file:///pico/${file}`),
	"import.meta.dirname": JSON.stringify("/pico"),
	"import.meta.filename": JSON.stringify(`/pico/${file}`),
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The prelude owns the real buffer/events/readable-stream copies and shares them via globalThis.__picoModules.
await esbuild.build({
	...common,
	entryPoints: [join(root, "src/prelude/index.ts")],
	outfile: join(out, "prelude.js"),
	platform: "browser",
	mainFields: ["browser", "module", "main"],
	conditions: ["browser", "import", "default"],
	plugins: [
		{
			name: "prelude-deps",
			setup(build) {
				build.onResolve({ filter: /^(process\/?|abort-controller)$/ }, (args) => ({
					path: join(root, args.path.startsWith("process") ? "src/stubs/process-lazy.cjs" : "src/stubs/abort-controller.ts"),
				}));
			},
		},
	],
});

const engine = await esbuild.build({
	...common,
	entryPoints: [join(root, "src/engine/index.ts")],
	outfile: join(out, "engine.js"),
	plugins: [shimPlugin],
	define: importMeta("engine.js"),
});
writeFileSync(join(out, "engine.meta.json"), JSON.stringify(engine.metafile));

await esbuild.build({
	...common,
	entryPoints: [join(root, "test/smoke.ts")],
	outfile: join(out, "smoke.js"),
	plugins: [shimPlugin],
});

if (withPi) {
	const pi = join(root, "../vendor/pi/packages/coding-agent");
	const result = await esbuild.build({
		...common,
		conditions: ["node", "import", "default"],
		entryPoints: [join(root, "src/entry.ts")],
		outfile: join(out, "pi.js"),
		plugins: [shimPlugin],
		define: {
			"import.meta.url": JSON.stringify("file:///pico/pkg/dist/pi.js"),
			"import.meta.dirname": JSON.stringify("/pico/pkg/dist"),
			"import.meta.filename": JSON.stringify("/pico/pkg/dist/pi.js"),
		},
	});
	writeFileSync(join(out, "pi.meta.json"), JSON.stringify(result.metafile));

	// pi resolves themes, templates and package.json from PI_PACKAGE_DIR.
	const pkg = join(out, "pkg");
	mkdirSync(pkg, { recursive: true });
	const piPackageJson = JSON.parse(readFileSync(join(pi, "package.json"), "utf8"));
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({ name: piPackageJson.name, version: piPackageJson.version, piConfig: piPackageJson.piConfig }, null, 2),
	);
	cpSync(join(pi, "src/modes/interactive/theme"), join(pkg, "dist/modes/interactive/theme"), {
		recursive: true,
		filter: (src) => !src.endsWith(".ts"),
	});
	cpSync(join(pi, "src/core/export-html"), join(pkg, "dist/core/export-html"), {
		recursive: true,
		filter: (src) => !src.endsWith(".ts"),
	});
}

const size = (file) => `${file} ${(readFileSync(join(out, file)).length / 1024 / 1024).toFixed(2)} MiB`;
console.log(["prelude.js", "engine.js", ...(withPi ? ["pi.js"] : [])].map(size).join(", "));
