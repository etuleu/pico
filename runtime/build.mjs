// Builds the pico runtime: dist/prelude.js (globals), dist/pi.js (pi in RPC mode), dist/pkg (pi assets).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { picoShims } from "./shims.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const pi = join(root, "../vendor/pi/packages/coding-agent");
const out = join(root, "dist");

const shimPlugin = picoShims(root);

const common = {
	bundle: true,
	format: "iife",
	platform: "neutral",
	target: "safari18",
	mainFields: ["module", "main"],
	conditions: ["node", "import", "default"],
	logLevel: "warning",
	sourcemap: "linked",
	legalComments: "none",
	loader: { ".node": "empty", ".wasm": "file" },
	metafile: true,
};

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

const result = await esbuild.build({
	...common,
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

await esbuild.build({ ...common, entryPoints: [join(root, "test/smoke.ts")], outfile: join(out, "smoke.js"), plugins: [shimPlugin] });

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

const size = (file) => `${(readFileSync(join(out, file)).length / 1024 / 1024).toFixed(2)} MiB`;
console.log(`prelude.js ${size("prelude.js")}, pi.js ${size("pi.js")}`);
