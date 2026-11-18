// Builds the durable spike into dist/durable-spike.js.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { picoShims } from "../shims.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await esbuild.build({
	entryPoints: [join(root, "spikes/durable.ts")],
	outfile: join(root, "dist/durable-spike.js"),
	bundle: true,
	format: "iife",
	platform: "neutral",
	target: "safari18",
	mainFields: ["module", "main"],
	conditions: ["source", "node", "import", "default"],
	nodePaths: [join(root, "../vendor/pi/node_modules")],
	plugins: [picoShims(root)],
	logLevel: "warning",
	define: { "import.meta.url": JSON.stringify("file:///pico/durable-spike.js") },
}).catch(() => process.exit(1));
