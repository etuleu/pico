// Requests from engine tools to the app's UI, with answers coming back as commands (e.g. the preview tool asks the app
// to show a page and gets the page's console output back).
import type { Event } from "./protocol.ts";

type Send = (event: Event) => void;

interface Pending {
	resolve: (value: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

let send: Send | undefined;
const pending = new Map<string, Pending>();
let nextId = 1;

export function connectUi(sender: Send): void {
	send = sender;
}

/** Sends `event` with a fresh `requestId` and resolves with the app's answer, or `fallback` after `timeoutMs`. */
export function askUi<T>(event: (requestId: string) => Event, fallback: T, timeoutMs: number): Promise<T> {
	if (!send) return Promise.resolve(fallback);
	const requestId = `ui-${nextId++}`;
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(requestId);
			resolve(fallback);
		}, timeoutMs);
		pending.set(requestId, { resolve: resolve as (value: unknown) => void, timer });
		send?.(event(requestId));
	});
}

/** Delivers the app's answer to a pending request. */
export function answerUi(requestId: string, value: unknown): void {
	const entry = pending.get(requestId);
	if (!entry) return;
	clearTimeout(entry.timer);
	pending.delete(requestId);
	entry.resolve(value);
}
