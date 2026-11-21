// The protocol between the pico engine (JS) and the app (Swift): one JSON object per line.
// Commands go to the engine on stdin; responses and events come back on stdout.
// Keep in sync with app/Sources/Engine/Protocol.swift.

export type Command =
	| { type: "init"; id?: string }
	| { type: "list_sessions"; id?: string }
	| { type: "new_session"; id?: string; cwd?: string }
	| { type: "open_session"; id?: string; sessionId: string }
	| { type: "delete_session"; id?: string; sessionId: string }
	| { type: "prompt"; id?: string; text: string; whenBusy?: "steer" | "follow_up" }
	| { type: "abort"; id?: string }
	| { type: "list_models"; id?: string }
	| { type: "set_model"; id?: string; provider: string; modelId: string }
	| { type: "set_thinking"; id?: string; level: ThinkingLevel }
	| { type: "set_env"; id?: string; name: string; value: string | null }
	/** The app's answer to a `preview` event. */
	| {
			type: "preview_result";
			id?: string;
			requestId: string;
			shown: boolean;
			logs: string[];
			/** JPEG of the page as shown, base64. */
			screenshot?: string;
			error?: string;
	  };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type Response =
	| { type: "response"; id?: string; command: Command["type"]; ok: true; data?: unknown }
	| { type: "response"; id?: string; command: string; ok: false; error: string };

export interface SessionInfo {
	id: string;
	title: string;
	cwd: string;
	createdAt: number;
	updatedAt: number;
	model?: { provider: string; modelId: string };
	/** A run was in progress when the session was last seen; opening the session continues it. */
	running?: boolean;
	/** When the current run started (ms since epoch). */
	runStartedAt?: number;
}

export interface ModelInfo {
	provider: string;
	modelId: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
}

/** One rendered transcript item. Tool calls and their results are merged into one `tool` item. */
export type Item =
	| { kind: "user"; id: string; text: string }
	| { kind: "assistant"; id: string; text: string; thinking?: string; error?: string }
	| {
			kind: "tool";
			id: string;
			callId: string;
			name: string;
			args: unknown;
			status: "pending" | "running" | "done" | "error";
			output?: string;
	  }
	| { kind: "notice"; id: string; text: string };

/** State of the open session, sent whenever it changes. `items` is omitted when only `live` changed. */
export interface ViewEvent {
	type: "view";
	sessionId: string;
	busy: boolean;
	/** When the current run started (ms since epoch); present while busy. */
	runStartedAt?: number;
	items?: Item[];
	/** The in-flight assistant message and running tools of the current round. */
	live?: {
		text?: string;
		thinking?: string;
		tools: Item[];
		/** Tool calls the model is still writing; big string arguments are replaced by `{ size }` in bytes. */
		writing?: Item[];
		retry?: { at: number; error: string };
	};
	failure?: { reason: string; detail?: string };
	model?: { provider: string; modelId: string };
	thinkingLevel?: ThinkingLevel;
	usage?: { input: number; output: number; cost: number };
}

export type Event =
	| ViewEvent
	| { type: "sessions"; sessions: SessionInfo[] }
	| { type: "error"; message: string }
	/** Show a web page (absolute path to an .html file); answer with `preview_result`. */
	| { type: "preview"; requestId: string; path: string }
	| { type: "ready"; version: string };
