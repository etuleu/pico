// Builds a spike: node spikes/build-spike.mjs <name>  ->  dist/<name>-spike.js from spikes/<name>.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { picoShims } from "../shims.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
await esbuild
	.build({
		entryPoints: [join(root, `spikes/${name}.ts`)],
		outfile: join(root, `dist/${name}-spike.js`),
		bundle: true,
		format: "iife",
		platform: "neutral",
		target: "safari18",
		mainFields: ["module", "main"],
		conditions: ["source", "node", "import", "default"],
		plugins: [picoShims(root)],
		logLevel: "warning",
		loader: { ".node": "empty", ".wasm": "file" },
		define: { "import.meta.url": JSON.stringify(`file:///pico/${name}-spike.js`) },
	})
	.catch(() => process.exit(1));
