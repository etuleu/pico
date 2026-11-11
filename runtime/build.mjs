// Builds the pico runtime: dist/prelude.js (globals), dist/pi.js (pi in RPC mode), dist/pkg (pi assets).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pi = join(root, "../vendor/pi/packages/coding-agent");
const out = join(root, "dist");
const shim = (name) => join(root, "src/node", name);

// Node built-ins -> shim modules. Keys are matched with and without the `node:` prefix.
const builtins = {
	assert: shim("assert.ts"),
	"assert/strict": shim("assert.ts"),
	async_hooks: shim("async_hooks.ts"),
	buffer: shim("buffer.ts"),
	child_process: shim("child_process.ts"),
	cluster: shim("misc.ts"),
	console: shim("console.ts"),
	constants: shim("constants.ts"),
	crypto: shim("crypto.ts"),
	dgram: shim("net.ts"),
	diagnostics_channel: shim("diagnostics_channel.ts"),
	dns: shim("dns.ts"),
	"dns/promises": shim("dns.ts"),
	events: shim("events.ts"),
	fs: shim("fs.ts"),
	"fs/promises": shim("fs-promises.ts"),
	http: shim("http.ts"),
	http2: shim("http.ts"),
	https: shim("http.ts"),
	inspector: shim("misc.ts"),
	module: shim("module.ts"),
	net: shim("net.ts"),
	os: shim("os.ts"),
	path: shim("path.ts"),
	"path/posix": shim("path.ts"),
	perf_hooks: shim("perf_hooks.ts"),
	process: shim("process.ts"),
	querystring: join(root, "node_modules/querystring-es3/index.js"),
	readline: shim("readline.ts"),
	"readline/promises": shim("readline.ts"),
	sqlite: shim("misc.ts"),
	stream: shim("stream.ts"),
	"stream/promises": shim("stream-promises.ts"),
	"stream/web": shim("stream-web.ts"),
	string_decoder: shim("string_decoder.ts"),
	timers: shim("timers.ts"),
	"timers/promises": shim("timers-promises.ts"),
	tls: shim("net.ts"),
	tty: shim("tty.ts"),
	url: shim("url.ts"),
	util: shim("util.ts"),
	"util/types": shim("util.ts"),
	v8: shim("misc.ts"),
	vm: shim("misc.ts"),
	worker_threads: shim("worker_threads.ts"),
	zlib: shim("zlib.ts"),
};

// npm packages replaced for this host.
const packages = {
	undici: join(root, "src/stubs/undici.ts"),
	"readable-stream": shim("stream.ts"),
	"process/": shim("process.ts"),
	"abort-controller": join(root, "src/stubs/abort-controller.ts"),
	bufferutil: join(root, "src/stubs/empty.ts"),
	"utf-8-validate": join(root, "src/stubs/empty.ts"),
};

const shimPlugin = {
	name: "pico-shims",
	setup(build) {
		build.onResolve({ filter: /.*/ }, async (args) => {
			const id = args.path.startsWith("node:") ? args.path.slice(5) : args.path;
			if (Object.hasOwn(builtins, id)) return { path: builtins[id] };
			if (Object.hasOwn(packages, id)) return { path: packages[id] };
			if (args.pluginData === "pico-resolved") return undefined;
			// pi's package.json `sideEffects` lists dist/ files; we bundle src/, so keep pi's own modules' side effects.
			const resolved = await build.resolve(args.path, {
				kind: args.kind,
				importer: args.importer,
				resolveDir: args.resolveDir,
				pluginData: "pico-resolved",
			});
			if (resolved.errors.length > 0) return undefined;
			if (/\/vendor\/pi\/packages\/[^/]+\/src\//.test(resolved.path)) return { ...resolved, sideEffects: true };
			return undefined;
		});
	},
};

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
