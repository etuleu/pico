// Maps Node built-ins and Node-only packages to pico's shims. Shared by every bundle that runs on the host.
import { dirname, join } from "node:path";

/** esbuild plugin; `root` is the runtime directory. */
export function picoShims(root) {
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

	return {
		name: "pico-shims",
		setup(build) {
			build.onResolve({ filter: /.*/ }, async (args) => {
				const id = args.path.startsWith("node:") ? args.path.slice(5) : args.path;
				// CommonJS `require("fs")` must return a mutable module object (graceful-fs patches it), not esbuild's
				// read-only ESM namespace: route it through a wrapper exporting the shim's default object.
				if (Object.hasOwn(builtins, id) && args.kind === "require-call") return { path: builtins[id], namespace: "pico-cjs" };
				if (Object.hasOwn(builtins, id)) return { path: builtins[id] };
				if (Object.hasOwn(packages, id)) return { path: packages[id] };
				if (args.pluginData === "pico-resolved") return undefined;
				// pi packages declare narrow `sideEffects`; esbuild then skips lazy module inits in IIFE bundles. Keep them all.
				const resolved = await build.resolve(args.path, {
					kind: args.kind,
					importer: args.importer,
					resolveDir: args.resolveDir,
					pluginData: "pico-resolved",
				});
				if (resolved.errors.length > 0) return undefined;
				if (/\/vendor\/pi\/packages\/[^/]+\/(src|dist)\//.test(resolved.path)) return { ...resolved, sideEffects: true };
				return undefined;
			});
			build.onLoad({ filter: /.*/, namespace: "pico-cjs" }, (args) => ({
				contents: `const m = require(${JSON.stringify(args.path)}); module.exports = m.default ?? m;`,
				resolveDir: dirname(args.path),
				loader: "js",
			}));
		},
	};
}
