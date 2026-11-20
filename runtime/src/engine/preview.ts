// The `preview` tool: shows a web app (an HTML file, or a folder with index.html) full screen in the app and returns
// what the page logged, so the agent sees its own runtime errors. Projects are plain folders in the workspace.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { askUi } from "./ui-bridge.ts";

export interface PreviewResult {
	shown: boolean;
	/** Console lines and uncaught errors from the first seconds after load. */
	logs: string[];
	error?: string;
}

const previewTool = defineTool({
	name: "preview",
	description:
		"Show a web app to the user full screen on their phone: pass an .html file or a folder containing index.html. The page reloads whenever its files change. Returns the page's console output and errors from the first seconds after loading; fix any errors and call preview again.",
	parameters: obj({ path: str({ description: "Path to an .html file or a folder with index.html" }) }),
	execute: async ({ path }, api) => {
		const base = api.env?.cwd ?? process.cwd();
		let file = resolve(base, path);
		if (existsSync(file) && statSync(file)?.isDirectory()) file = join(file, "index.html");
		if (!existsSync(file)) {
			return { output: [{ type: "text", text: `Not found: ${file}` }], isError: true };
		}
		const result = await askUi<PreviewResult>(
			(requestId) => ({ type: "preview", requestId, path: file }),
			{ shown: false, logs: [], error: "The app did not answer (no preview available here)." },
			20_000,
		);
		if (!result.shown) {
			return { output: [{ type: "text", text: `Preview failed: ${result.error ?? "unknown error"}` }], isError: true };
		}
		const errors = result.logs.filter((line) => line.startsWith("[error]"));
		const console =
			result.logs.length === 0 ? "No console output." : `Console (first seconds):\n${result.logs.slice(0, 50).join("\n")}`;
		return {
			output: [
				{
					type: "text",
					text: `Showing ${file} to the user.${errors.length ? ` ${errors.length} error(s) — fix them.` : ""}\n${console}`,
				},
			],
			details: { path: file },
		};
	},
});

export const PreviewTools = defineExtension({ name: "pico-preview", tools: [previewTool] });
