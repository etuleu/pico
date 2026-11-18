// Spike: pi-durable in JavaScriptCore. A Harness with DeepInfra, the coding tools, NodeExecutionEnv over pico's
// shims, and JSONL storage. Run: node spikes/build-durable.mjs && pico-cli --bundle dist --script dist/durable-spike.js --cwd <dir>
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { AssistantEntry, createRegistry, defineExtension, Harness, LiveDoc, section, ToolResultEntry } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT;
const log = (...args: unknown[]) => globalThis.__pico.log("log", args.map(String).join(" "));
const modelId = "deepseek-ai/DeepSeek-V4-Flash";

async function main(): Promise<void> {
	const models = createModels();
	models.setProvider(
		createProvider({
			id: "deepinfra",
			baseUrl: "https://api.deepinfra.com/v1/openai",
			auth: { apiKey: envApiKeyAuth("DeepInfra API key", ["DEEPINFRA_API_KEY"]) },
			api: openAICompletionsApi(),
			models: [
				{
					id: modelId,
					name: modelId,
					api: "openai-completions",
					provider: "deepinfra",
					baseUrl: "https://api.deepinfra.com/v1/openai",
					input: ["text"],
					reasoning: false,
					contextWindow: 131072,
					maxTokens: 16384,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		}),
	);

	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(
		defineExtension({
			name: "coding",
			sections: [
				section("preamble", () => "You are a coding agent. Use the tools.", { tag: false }),
				section("cwd", (input) => input.env?.cwd),
			],
		}),
	);

	const cwd = process.cwd();
	const phase = process.env.SPIKE_PHASE ?? "fresh";
	const started = performance.now();
	const storage = await openNodeJsonlStorage(`${cwd}/.durable`, context);
	const harness = await Harness.open(storage, { models, registry, env: ({ cwd: dir }) => new NodeExecutionEnv({ cwd: dir ?? cwd }) }, context);
	const root = await harness.root(context, { agent: { model: { provider: "deepinfra", modelId }, cwd } });
	log(`opened harness in ${Math.round(performance.now() - started)} ms (phase ${phase})`);

	const prompts: Record<string, string> = {
		fresh: "Read hello.txt, then write upper.txt with its contents uppercased, then run `wc -c upper.txt` with bash.",
		resume: "What did wc print earlier? Answer with just the number.",
		crash: "Run `sleep 6; date +%s > slept.txt` with bash (the bash tool), then reply with the word finished.",
	};

	// Stream: count live document updates while the run is going.
	const watch = await root.watch(context);
	let updates = 0;
	watch.start(async (call) => {
		if (call.kind === "value") updates++;
	});

	let status = "done";
	if (phase === "recover") {
		// The previous process was killed mid-run: continue its work, then wait until the conversation is idle.
		harness.resume();
		while (true) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			const live = await harness.snapshot(LiveDoc, root.id, context);
			if (live?.run === undefined) {
				if (live?.runFailure) status = `failed: ${JSON.stringify(live.runFailure)}`;
				break;
			}
		}
	} else {
		const submission = await root.submit({ type: "input", content: prompts[phase] }, context);
		if (phase === "crash") log("submitted; waiting to be killed");
		const settled = await submission.wait(context);
		status = settled.status;
	}
	log(`settled: ${status} after ${Math.round(performance.now() - started)} ms, ${updates} watch updates`);

	const page = await root.entries({}, 50, undefined, context);
	for (const entry of page.items) {
		if (AssistantEntry.is(entry)) {
			for (const message of entry.model ?? []) {
				for (const part of (message as { content: { type: string; text?: string; name?: string; arguments?: unknown }[] }).content) {
					if (part.type === "text" && part.text?.trim()) log("assistant:", JSON.stringify(part.text.trim()).slice(0, 200));
					if (part.type === "toolCall") log("tool call:", part.name, JSON.stringify(part.arguments));
				}
			}
		} else if (ToolResultEntry.is(entry)) {
			const message = entry.model?.[0] as { isError?: boolean; content: { type: string; text?: string }[] };
			log("  result:", message.isError ? "ERROR" : "ok", JSON.stringify(message.content.map((c) => c.text ?? "").join("")).slice(0, 150));
		}
	}

	await watch.stop();
	await harness.close(context);
	process.exit(status === "done" ? 0 : 1);
}

main().catch((error: unknown) => {
	globalThis.__pico.log("error", `spike failed: ${(error as Error)?.stack ?? error}\n${String(error)}`);
	process.exit(2);
});
