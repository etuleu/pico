// pico engine entry: pi-durable sessions driven by JSONL commands on stdin; events and responses on stdout.
// See protocol.ts. Paths follow pi: agent dir `~/.pi/agent` (models.json, settings.json, AGENTS.md).
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MutableModels } from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createAgentsExtension, loadAgents } from "./agents.ts";
import { createCodingExtension } from "./coding.ts";
import { loadModels, loadSettings, type Settings } from "./config.ts";
import type { Command, Event, ModelInfo, Response } from "./protocol.ts";
import { OpenSession, SessionStore } from "./session.ts";
import { PicoExecutionEnv } from "./shell-env.ts";
import { WebTools } from "./web.ts";
import { PreviewTools } from "./preview.ts";
import { answerUi, connectUi } from "./ui-bridge.ts";

const VERSION = "0.1.0";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const sessionsDir = process.env.PICO_SESSIONS_DIR || join(homedir(), ".pi", "pico", "sessions");
const workspace = process.env.PICO_WORKSPACE || process.cwd();

function send(message: Event | Response): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message: string): void {
	process.stderr.write(`${message}\n`);
}

const store = new SessionStore(sessionsDir);
const registry = createRegistry();
registry.install(CodingTools);
registry.install(createCodingExtension({ agentDir, platform: process.env.PICO_PLATFORM || "iOS" }));
// Tools only agents use (listed in their files); hidden from the main conversation below.
registry.install(WebTools);
registry.install(PreviewTools);
const agents = loadAgents(agentDir, log);
registry.install(createAgentsExtension(agents, registry, log));
let models: MutableModels = loadModels(agentDir, log);
let settings: Settings = loadSettings(agentDir);
let current: OpenSession | undefined;

async function availableModels(): Promise<ModelInfo[]> {
	const list = await models.getAvailable();
	return list.map((model) => ({
		provider: model.provider,
		modelId: model.id,
		name: model.name,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
	}));
}

/** The settings default when it is available, otherwise the first available model. */
async function defaultModel(): Promise<{ provider: string; modelId: string } | undefined> {
	const available = await availableModels();
	const preferred = available.find(
		(model) => model.provider === settings.defaultProvider && model.modelId === settings.defaultModel,
	);
	const model = preferred ?? available[0];
	return model ? { provider: model.provider, modelId: model.modelId } : undefined;
}

function saveDefaultModel(provider: string, modelId: string): void {
	settings = { ...loadSettings(agentDir), defaultProvider: provider, defaultModel: modelId };
	try {
		writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	} catch (error) {
		log(`settings.json: ${(error as Error).message}`);
	}
}

async function open(sessionId: string): Promise<OpenSession> {
	const meta = store.read(sessionId);
	if (!meta) throw new Error(`Unknown session: ${sessionId}`);
	if (current?.meta.id === sessionId) {
		current.refresh();
		return current;
	}
	await current?.close();
	current = undefined;
	const model = meta.model ?? (await defaultModel());
	current = await OpenSession.open({
		store,
		meta,
		models,
		registry,
		env: (cwd) => new PicoExecutionEnv({ cwd }),
		initialAgent: model ? { model } : {},
		mainAgent: { extensions: { remove: [WebTools] } },
		emit: send,
	});
	return current;
}

function requireSession(): OpenSession {
	if (!current) throw new Error("No open session");
	return current;
}

async function handle(command: Command): Promise<unknown> {
	switch (command.type) {
		case "init": {
			const sessions = store.list();
			// A session whose run was cut off (the app was killed or suspended) is reported so the app reopens it;
			// opening it lets pi-durable continue the run.
			const interrupted = sessions.find((session) => session.running)?.id;
			return {
				version: VERSION,
				agentDir,
				workspace,
				sessions,
				models: await availableModels(),
				interrupted,
				agents: agents.map(({ name, description, model }) => ({ name, description, model })),
			};
		}
		case "list_sessions":
			return store.list();
		case "new_session": {
			const meta = store.create(command.cwd ?? workspace);
			await open(meta.id);
			send({ type: "sessions", sessions: store.list() });
			return meta;
		}
		case "open_session":
			return (await open(command.sessionId)).meta;
		case "delete_session":
			if (current?.meta.id === command.sessionId) {
				await current.close();
				current = undefined;
			}
			store.delete(command.sessionId);
			send({ type: "sessions", sessions: store.list() });
			return undefined;
		case "prompt":
			await requireSession().prompt(command.text, command.whenBusy);
			send({ type: "sessions", sessions: store.list() });
			return undefined;
		case "abort":
			await requireSession().abort();
			return undefined;
		case "list_models":
			return await availableModels();
		case "set_model":
			saveDefaultModel(command.provider, command.modelId);
			if (current) await current.configure({ model: { provider: command.provider, modelId: command.modelId } });
			return undefined;
		case "set_thinking":
			await requireSession().configure({ thinkingLevel: command.level });
			return undefined;
		case "preview_result":
			answerUi(command.requestId, { shown: command.shown, logs: command.logs, error: command.error });
			return undefined;
		case "set_env":
			if (command.value === null) delete process.env[command.name];
			else process.env[command.name] = command.value;
			// Providers resolve keys per request; reload models.json since its keys may reference the variable.
			models = loadModels(agentDir, log);
			return await availableModels();
	}
}

// Commands are handled one at a time, in order.
let queue: Promise<void> = Promise.resolve();

function dispatch(line: string): void {
	let command: Command;
	try {
		command = JSON.parse(line) as Command;
	} catch {
		send({ type: "response", command: "parse", ok: false, error: `Invalid JSON: ${line.slice(0, 200)}` });
		return;
	}
	queue = queue.then(async () => {
		try {
			const data = await handle(command);
			send({ type: "response", id: command.id, command: command.type, ok: true, ...(data === undefined ? {} : { data }) });
		} catch (error) {
			send({ type: "response", id: command.id, command: command.type, ok: false, error: (error as Error).message ?? String(error) });
		}
	});
}

let buffer = "";
process.stdin.on("data", (chunk: string | Uint8Array) => {
	buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
	let index = buffer.indexOf("\n");
	while (index !== -1) {
		const line = buffer.slice(0, index).replace(/\r$/, "");
		buffer = buffer.slice(index + 1);
		if (line.trim()) dispatch(line);
		index = buffer.indexOf("\n");
	}
});
process.stdin.on("end", () => {
	void queue.then(async () => {
		await current?.close();
		process.exit(0);
	});
});

connectUi(send);
send({ type: "ready", version: VERSION });
