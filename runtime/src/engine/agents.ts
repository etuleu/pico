// Agents as files: each `<agentDir>/agents/<name>.md` (pi's subagent format: frontmatter + instructions) becomes one tool
// for the main agent. Calling it runs a child conversation owned by the call, with the agent's model, tools and
// instructions, and returns the child's final answer. The call parks while the child works, so an interrupted app
// picks the work up again on the next launch.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentChange,
	configure,
	defineExtension,
	defineTool,
	type Extension,
	type Registry,
	SubmissionSettled,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";

export interface AgentDefinition {
	/** Tool name (`name` in the frontmatter, else the file name), e.g. `web_search`. */
	name: string;
	description: string;
	/** `provider/modelId`; the parent's model when absent. */
	model?: string;
	/** Tool names; the parent's tools when absent. */
	tools?: string[];
	/** The system instructions (the file's body). */
	instructions: string;
	path: string;
}

/** Parses `---\nkey: value\n---\nbody`. Values are plain strings; `tools` is a comma-separated list. */
function parseAgentFile(path: string): AgentDefinition | string {
	const source = (readFileSync(path, "utf8") as string).replace(/^\uFEFF/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
	if (!match) return `${path}: missing frontmatter (--- ... ---)`;
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (field) fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
	}
	const name = (fields.name || basename(path, ".md")).replace(/[^A-Za-z0-9_-]/g, "_");
	if (!fields.description) return `${path}: frontmatter needs a description`;
	return {
		name,
		description: fields.description,
		model: fields.model || undefined,
		tools: fields.tools ? fields.tools.split(",").map((tool) => tool.trim()).filter(Boolean) : undefined,
		instructions: match[2].trim(),
		path,
	};
}

export function loadAgents(agentDir: string, log: (message: string) => void): AgentDefinition[] {
	const dir = join(agentDir, "agents");
	if (!existsSync(dir)) return [];
	const agents: AgentDefinition[] = [];
	for (const file of (readdirSync(dir) as string[]).filter((name) => name.endsWith(".md")).sort()) {
		const parsed = parseAgentFile(join(dir, file));
		if (typeof parsed === "string") log(`agents: ${parsed}`);
		else agents.push(parsed);
	}
	return agents;
}

/** `deepinfra/deepseek-ai/DeepSeek-V4-Flash` -> provider `deepinfra`, model `deepseek-ai/DeepSeek-V4-Flash`. */
function modelRef(model: string): { provider: string; modelId: string } | undefined {
	const slash = model.indexOf("/");
	return slash > 0 ? { provider: model.slice(0, slash), modelId: model.slice(slash + 1) } : undefined;
}

function textOf(message: AssistantMessage | undefined): string {
	return (message?.content ?? [])
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/** One tool per agent file. `registry` resolves the tools agents list; agents never get agent tools themselves. */
export function createAgentsExtension(agents: AgentDefinition[], registry: Registry, log: (message: string) => void): Extension {
	const extension: Extension = defineExtension({
		name: "pico-agents",
		tools: agents.map((agent) => agentTool(agent, registry, () => extension, log)),
	});
	return extension;
}

function agentTool(
	agent: AgentDefinition,
	registry: Registry,
	self: () => Extension,
	log: (message: string) => void,
): ToolRegistration {
	return defineTool({
		name: agent.name,
		description: `${agent.description}\n\nRuns a separate agent with a fresh context: it sees only the task you write, not this conversation, so make the task self-contained (include the details, names and paths it needs). Returns the agent's final answer.`,
		parameters: obj({ task: str({ description: "The complete, self-contained task for the agent" }) }),
		// A rerun after a crash finds the same child conversation and submission (request ID, ownership index).
		replay: "safe",
		execute: async ({ task }, api, context) => {
			const state = await api.readSignal(SubmissionSettled, "answered", context);
			if (state !== undefined && "value" in state) {
				const settled = state.value;
				if (settled.status !== "done" || settled.type === "write") {
					const reason = "reason" in settled ? ` (${String(settled.reason)})` : "";
					return { output: [{ type: "text", text: `The ${agent.name} agent did not answer: ${settled.status}${reason}` }], isError: true };
				}
				const entry = await api.commit((tx) => tx.entry(settled.answer), context);
				const answer = textOf(entry?.model?.[0] as AssistantMessage | undefined);
				return { output: [{ type: "text", text: answer || "(the agent gave no text answer)" }] };
			}
			if (state !== undefined) return { output: [{ type: "text", text: `The ${agent.name} agent timed out` }], isError: true };

			// The child's agent: every extension but the agent tools, the agent's tools, model and instructions.
			const installed = registry.snapshot().installed();
			const extensions = installed.filter((candidate) => candidate.name !== self().name);
			const available = extensions.flatMap((candidate) => candidate.tools ?? []);
			const change: { -readonly [K in keyof AgentChange]: AgentChange[K] } = { extensions, instructions: agent.instructions };
			if (agent.tools) {
				const tools = agent.tools.map((name) => available.find((tool) => tool.name === name));
				const missing = agent.tools.filter((_, index) => tools[index] === undefined);
				if (missing.length) log(`agents: ${agent.path}: unknown tools ${missing.join(", ")}`);
				change.tools = tools.filter((tool): tool is ToolRegistration => tool !== undefined);
			}
			if (agent.model) {
				const ref = modelRef(agent.model);
				if (ref) change.model = ref;
				else log(`agents: ${agent.path}: model must be provider/modelId`);
			}

			const child = await api.commit(async (tx) => {
				const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
				if (existing !== undefined) return existing.id;
				const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
				await configure(tx, created.id, change);
				return created.id;
			}, context);
			await api.details({ agent: agent.name, conversationId: child }, context);
			const handle = await api.conversation(child, context);
			if (!handle) return { output: [{ type: "text", text: "The agent conversation is missing" }], isError: true };
			await handle.submit(
				{ type: "input", content: task, requestId: `agent:${api.taskId}`, notify: { taskId: api.taskId, key: "answered" } },
				context,
			);
			// Park until the child's submission settles; no process is held meanwhile.
			return { sleep: { signals: [SubmissionSettled.key("answered")] } };
		},
	});
}
