// Minimal DOM event primitives: Event, EventTarget, AbortController, AbortSignal, DOMException.

export class DOMException extends Error {
	readonly code: number;

	constructor(message = "", name = "Error") {
		super(message);
		this.name = name;
		this.code = name === "AbortError" ? 20 : name === "TimeoutError" ? 23 : 0;
	}
}

export class Event {
	readonly type: string;
	readonly bubbles: boolean;
	readonly cancelable: boolean;
	readonly timeStamp = Date.now();
	defaultPrevented = false;
	target: EventTarget | null = null;
	currentTarget: EventTarget | null = null;
	_stop = false;

	constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
		this.type = String(type);
		this.bubbles = init.bubbles ?? false;
		this.cancelable = init.cancelable ?? false;
	}

	preventDefault(): void {
		if (this.cancelable) this.defaultPrevented = true;
	}

	stopPropagation(): void {}

	stopImmediatePropagation(): void {
		this._stop = true;
	}
}

export class CustomEvent<T = unknown> extends Event {
	readonly detail: T | null;

	constructor(type: string, init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {}) {
		super(type, init);
		this.detail = init.detail ?? null;
	}
}

type Listener = ((event: Event) => void) | { handleEvent(event: Event): void };

interface ListenerEntry {
	listener: Listener;
	once: boolean;
}

export class EventTarget {
	private _listeners = new Map<string, ListenerEntry[]>();

	addEventListener(
		type: string,
		listener: Listener | null,
		options?: boolean | { once?: boolean; signal?: AbortSignal },
	): void {
		if (!listener) return;
		const opts = typeof options === "object" ? options : {};
		if (opts.signal?.aborted) return;
		const list = this._listeners.get(type) ?? [];
		if (list.some((entry) => entry.listener === listener)) return;
		list.push({ listener, once: opts.once ?? false });
		this._listeners.set(type, list);
		opts.signal?.addEventListener("abort", () => this.removeEventListener(type, listener), { once: true });
	}

	removeEventListener(type: string, listener: Listener | null): void {
		const list = this._listeners.get(type);
		if (!list) return;
		const index = list.findIndex((entry) => entry.listener === listener);
		if (index >= 0) list.splice(index, 1);
	}

	dispatchEvent(event: Event): boolean {
		event.target = this;
		event.currentTarget = this;
		const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
		if (typeof handler === "function") handler.call(this, event);
		for (const entry of [...(this._listeners.get(event.type) ?? [])]) {
			if (entry.once) this.removeEventListener(event.type, entry.listener);
			try {
				if (typeof entry.listener === "function") entry.listener.call(this, event);
				else entry.listener.handleEvent(event);
			} catch (error) {
				globalThis.reportError?.(error);
			}
			if (event._stop) break;
		}
		return !event.defaultPrevented;
	}
}

export class AbortSignal extends EventTarget {
	aborted = false;
	reason: unknown = undefined;
	onabort: ((event: Event) => void) | null = null;

	throwIfAborted(): void {
		if (this.aborted) throw this.reason;
	}

	_abort(reason: unknown): void {
		if (this.aborted) return;
		this.aborted = true;
		this.reason = reason === undefined ? new DOMException("This operation was aborted", "AbortError") : reason;
		this.dispatchEvent(new Event("abort"));
	}

	static abort(reason?: unknown): AbortSignal {
		const signal = new AbortSignal();
		signal._abort(reason);
		return signal;
	}

	static timeout(ms: number): AbortSignal {
		const signal = new AbortSignal();
		const timer = setTimeout(() => signal._abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
		(timer as unknown as { unref?: () => void }).unref?.();
		return signal;
	}

	static any(signals: Iterable<AbortSignal>): AbortSignal {
		const combined = new AbortSignal();
		for (const signal of signals) {
			if (signal.aborted) {
				combined._abort(signal.reason);
				return combined;
			}
		}
		for (const signal of signals) {
			signal.addEventListener("abort", () => combined._abort(signal.reason), { once: true });
		}
		return combined;
	}
}

export class AbortController {
	readonly signal = new AbortSignal();

	abort(reason?: unknown): void {
		this.signal._abort(reason);
	}
}

export function installEvents(): void {
	Object.assign(globalThis, { DOMException, Event, CustomEvent, EventTarget, AbortSignal, AbortController });
	globalThis.reportError ??= (error: unknown) => {
		console.error("Uncaught", error);
	};
}
