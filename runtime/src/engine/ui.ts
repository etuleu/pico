// Converts durable transcript entries and live state into the UI items of the protocol.
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { EntryRecord, LiveState } from "@earendil-works/pi-durable";
import type { Item } from "./protocol.ts";

function textOf(content: UserMessage["content"] | ToolResultMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? part.text : part.type === "image" ? "[image]" : ""))
		.filter(Boolean)
		.join("\n");
}

function assistantParts(message: AssistantMessage): { text: string; thinking: string } {
	let text = "";
	let thinking = "";
	for (const part of message.content) {
		if (part.type === "text") text += part.text;
		else if (part.type === "thinking") thinking += part.thinking;
	}
	return { text: text.trim(), thinking: thinking.trim() };
}

/** Ordered transcript items, built incrementally from entries; tool results update their call's item in place. */
export class Transcript {
	readonly items: Item[] = [];
	private readonly seen = new Set<string>();
	private readonly toolIndex = new Map<string, number>();

	/** Adds entries not seen yet. Returns whether anything changed. */
	add(entries: readonly EntryRecord[]): boolean {
		let changed = false;
		for (const entry of entries) {
			const key = String(entry.id);
			if (this.seen.has(key)) continue;
			this.seen.add(key);
			changed = this.addEntry(entry) || changed;
		}
		return changed;
	}

	private addEntry(entry: EntryRecord): boolean {
		const id = String(entry.id);
		const message = entry.model?.[0] as Message | undefined;
		switch (entry.kind) {
			case "pi.user": {
				if (!message || message.role !== "user") return false;
				this.items.push({ kind: "user", id, text: textOf(message.content) });
				return true;
			}
			case "pi.assistant": {
				if (!message || message.role !== "assistant") return false;
				const { text, thinking } = assistantParts(message);
				const error =
					message.stopReason === "error" || message.stopReason === "aborted"
						? (message.errorMessage ?? message.stopReason)
						: undefined;
				if (text || thinking || error) {
					this.items.push({
						kind: "assistant",
						id,
						text,
						...(thinking ? { thinking } : {}),
						...(error ? { error } : {}),
					});
				}
				for (const part of message.content) {
					if (part.type !== "toolCall") continue;
					this.toolIndex.set(part.id, this.items.length);
					this.items.push({
						kind: "tool",
						id: `${id}:${part.id}`,
						callId: part.id,
						name: part.name,
						args: part.arguments,
						status: "pending",
					});
				}
				return true;
			}
			case "pi.tool-result": {
				if (!message || message.role !== "toolResult") return false;
				const index = this.toolIndex.get(message.toolCallId);
				const output = textOf(message.content);
				if (index === undefined) {
					this.items.push({
						kind: "tool",
						id,
						callId: message.toolCallId,
						name: message.toolName,
						args: {},
						status: message.isError ? "error" : "done",
						output,
					});
					return true;
				}
				const item = this.items[index];
				if (item.kind === "tool") {
					this.items[index] = { ...item, status: message.isError ? "error" : "done", output };
				}
				return true;
			}
			case "pi.compaction":
				this.items.push({ kind: "notice", id, text: "Context compacted" });
				return true;
			case "pi.reset":
				this.items.push({ kind: "notice", id, text: "New context" });
				return true;
			default:
				return false;
		}
	}
}

/** The live part of the view: the in-flight answer and the running tools' progress, keyed by call id. */
export function liveOf(live: LiveState | undefined) {
	if (!live) return undefined;
	const message = live.generation?.message as AssistantMessage | undefined;
	const parts = message ? assistantParts(message) : undefined;
	// Tool calls the model is still writing (streamed arguments). Large string arguments (file contents) are sent as
	// their size only, so a 30 KB write does not travel to the app on every update.
	const writing: Item[] = [];
	if (message && !live.tools?.length) {
		for (const part of message.content) {
			if (part.type !== "toolCall") continue;
			const args: Record<string, unknown> = {};
			for (const [key, value] of Object.entries((part.arguments ?? {}) as Record<string, unknown>)) {
				args[key] = typeof value === "string" && value.length > 300 ? { size: new TextEncoder().encode(value).length } : value;
			}
			writing.push({ kind: "tool", id: `writing:${part.id}`, callId: part.id, name: part.name, args, status: "pending" });
		}
	}
	const tools: Item[] = (live.tools ?? []).map((slot) => ({
		kind: "tool",
		id: slot.callId,
		callId: slot.callId,
		name: slot.name,
		args: {},
		status: slot.status === "done" ? "done" : slot.status === "pending" ? "pending" : "running",
		...(slot.output ? { output: slot.output } : {}),
	}));
	return {
		...(parts?.text ? { text: parts.text } : {}),
		...(parts?.thinking ? { thinking: parts.thinking } : {}),
		tools,
		...(writing.length ? { writing } : {}),
		...(live.generation?.retry ? { retry: live.generation.retry } : {}),
	};
}
