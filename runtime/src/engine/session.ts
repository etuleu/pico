// Sessions: one durable storage per chat, in `<sessionsDir>/<id>/`, with a small `meta.json` for the session list.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import {
	type AgentChange,
	type Conversation,
	type ConversationWatch,
	type EntryRecord,
	Harness,
	type LiveState,
	type Registry,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import type { SessionInfo, ThinkingLevel, ViewEvent } from "./protocol.ts";
import { liveOf, Transcript } from "./ui.ts";

const context = BACKGROUND_CONTEXT;

export class SessionStore {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
		mkdirSync(dir, { recursive: true });
	}

	list(): SessionInfo[] {
		const sessions: SessionInfo[] = [];
		for (const name of readdirSync(this.dir) as string[]) {
			const meta = this.read(name);
			if (meta) sessions.push(meta);
		}
		return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	read(id: string): SessionInfo | undefined {
		try {
			return JSON.parse(readFileSync(join(this.dir, id, "meta.json"), "utf8") as string) as SessionInfo;
		} catch {
			return undefined;
		}
	}

	write(meta: SessionInfo): void {
		mkdirSync(join(this.dir, meta.id), { recursive: true });
		writeFileSync(join(this.dir, meta.id, "meta.json"), JSON.stringify(meta, null, 2));
	}

	create(cwd: string): SessionInfo {
		const now = Date.now();
		const meta: SessionInfo = { id: `${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`, title: "New session", cwd, createdAt: now, updatedAt: now };
		this.write(meta);
		return meta;
	}

	delete(id: string): void {
		if (existsSync(join(this.dir, id))) rmSync(join(this.dir, id), { recursive: true, force: true });
	}

	storageDir(id: string): string {
		return join(this.dir, id, "store");
	}
}

export interface OpenSessionOptions {
	store: SessionStore;
	meta: SessionInfo;
	models: Models;
	registry: Registry;
	env: (cwd: string) => ExecutionEnv;
	/** Agent choices for a session opened for the first time. */
	initialAgent: AgentChange;
	/** Applied to the main conversation on every open (e.g. hiding tools only agents use). */
	mainAgent?: AgentChange;
	emit: (event: ViewEvent) => void;
}

/** An open session: its Harness, root conversation, and a watch that emits view events. */
export class OpenSession {
	readonly meta: SessionInfo;
	private readonly options: OpenSessionOptions;
	private harness!: Harness;
	private root!: Conversation;
	private watch?: ConversationWatch;
	private readonly transcript = new Transcript();

	private constructor(options: OpenSessionOptions) {
		this.options = options;
		this.meta = options.meta;
	}

	static async open(options: OpenSessionOptions): Promise<OpenSession> {
		const session = new OpenSession(options);
		await session.start();
		return session;
	}

	private async start(): Promise<void> {
		const { store, meta, models, registry, env } = this.options;
		const storage = await openNodeJsonlStorage(store.storageDir(meta.id), context);
		this.harness = await Harness.open(
			storage,
			{ models, registry, env: ({ cwd }) => env(cwd ?? meta.cwd) },
			context,
		);
		this.root = await this.harness.root(context, { agent: { cwd: meta.cwd, ...this.options.initialAgent } });
		if (this.options.mainAgent) await this.root.configure(this.options.mainAgent, context);

		// Full history first, then the watch appends.
		let cursor: Parameters<Conversation["entries"]>[2];
		do {
			const page = await this.root.entries({ order: "ascending" }, 500, cursor, context);
			this.transcript.add(page.items);
			cursor = page.next;
		} while (cursor !== undefined);

		this.watch = await this.root.watch(context);
		this.emitView(this.watch.value, true);
		this.watch.start(async (call) => {
			if (call.kind === "value") this.emitView(call.value);
		});
		// Continue work an earlier process left unfinished (the app was killed or suspended mid-run).
		this.harness.resume();
	}

	private emitView(value: { entries: readonly EntryRecord[]; docs: Readonly<Record<string, unknown>> }, full = false): void {
		const changed = this.transcript.add(value.entries) || full;
		const live = value.docs["pi.live"] as LiveState | undefined;
		const agent = value.docs["pi.agent"] as { model?: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel } | undefined;
		const usage = value.docs["pi.usage"] as { models?: Record<string, { input?: number; output?: number; cost?: { total?: number } }> } | undefined;
		let input = 0;
		let output = 0;
		let cost = 0;
		for (const entry of Object.values(usage?.models ?? {})) {
			input += entry.input ?? 0;
			output += entry.output ?? 0;
			cost += entry.cost?.total ?? 0;
		}
		const busy = live?.run !== undefined;
		if (busy !== (this.meta.running ?? false)) {
			this.meta.running = busy;
			this.meta.updatedAt = Date.now();
			this.options.store.write(this.meta);
		}
		this.options.emit({
			type: "view",
			sessionId: this.meta.id,
			busy,
			...(changed ? { items: this.transcript.items } : {}),
			live: liveOf(live),
			...(live?.runFailure ? { failure: { reason: live.runFailure.reason, detail: live.runFailure.detail } } : {}),
			...(agent?.model ? { model: agent.model } : {}),
			...(agent?.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
			usage: { input, output, cost },
		});
	}

	/** Re-sends the full view (for example after the app reconnects its UI). */
	refresh(): void {
		if (this.watch) this.emitView(this.watch.value, true);
	}

	async prompt(text: string, whenBusy: "steer" | "follow_up" = "follow_up"): Promise<void> {
		if (this.meta.title === "New session") {
			this.meta.title = text.replace(/\s+/g, " ").trim().slice(0, 80) || "New session";
		}
		this.meta.updatedAt = Date.now();
		this.options.store.write(this.meta);
		await this.root.submit(
			{ type: "input", content: text, whenBusy: whenBusy === "steer" ? "steer" : "followUp" },
			context,
		);
	}

	async abort(): Promise<void> {
		await this.root.abort(context);
	}

	async configure(change: AgentChange): Promise<void> {
		await this.root.configure(change, context);
		const agent = await this.root.agent(context);
		if (agent.model) {
			this.meta.model = { provider: agent.model.provider, modelId: agent.model.modelId };
			this.options.store.write(this.meta);
		}
	}

	async close(): Promise<void> {
		await this.watch?.stop();
		await this.harness.close(context);
	}
}
