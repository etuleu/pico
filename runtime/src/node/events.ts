// node:events: the `events` npm package plus the Node statics it lacks.
import { shared } from "../shared.ts";

export const EventEmitter = shared.events;
type Emitter = InstanceType<typeof EventEmitter>;
export const errorMonitor = Symbol("events.errorMonitor");
export const captureRejectionSymbol = Symbol.for("nodejs.rejection");
export const defaultMaxListeners = 10;

export function once(emitter: Emitter | EventTarget, name: string, options?: { signal?: AbortSignal }): Promise<unknown[]> {
	return new Promise((resolve, reject) => {
		if ("addEventListener" in emitter && !("on" in emitter)) {
			emitter.addEventListener(name, (event) => resolve([event]), { once: true, signal: options?.signal });
			return;
		}
		const target = emitter as Emitter;
		const onEvent = (...args: unknown[]) => {
			cleanup();
			resolve(args);
		};
		const onError = (error: unknown) => {
			cleanup();
			reject(error);
		};
		const onAbort = () => {
			cleanup();
			reject(options?.signal?.reason);
		};
		const cleanup = () => {
			target.removeListener(name, onEvent);
			if (name !== "error") target.removeListener("error", onError);
			options?.signal?.removeEventListener("abort", onAbort);
		};
		target.on(name, onEvent);
		if (name !== "error") target.on("error", onError);
		options?.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function on(emitter: Emitter, name: string, options?: { signal?: AbortSignal }): AsyncIterableIterator<unknown[]> {
	const queue: unknown[][] = [];
	const waiters: { resolve: (r: IteratorResult<unknown[]>) => void; reject: (e: unknown) => void }[] = [];
	let error: unknown;
	let done = false;
	const onEvent = (...args: unknown[]) => {
		const waiter = waiters.shift();
		if (waiter) waiter.resolve({ value: args, done: false });
		else queue.push(args);
	};
	const onError = (err: unknown) => {
		error = err;
		const waiter = waiters.shift();
		waiter?.reject(err);
	};
	const finish = () => {
		done = true;
		emitter.removeListener(name, onEvent);
		emitter.removeListener("error", onError);
		for (const waiter of waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
	};
	emitter.on(name, onEvent);
	if (name !== "error") emitter.on("error", onError);
	options?.signal?.addEventListener("abort", finish, { once: true });
	return {
		next() {
			if (queue.length) return Promise.resolve({ value: queue.shift() as unknown[], done: false });
			if (error) return Promise.reject(error);
			if (done) return Promise.resolve({ value: undefined, done: true });
			return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
		},
		return() {
			finish();
			return Promise.resolve({ value: undefined, done: true });
		},
		throw(err: unknown) {
			finish();
			return Promise.reject(err);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}

export function setMaxListeners(): void {}

export function getMaxListeners(): number {
	return defaultMaxListeners;
}

export function getEventListeners(emitter: Emitter | EventTarget, name: string): unknown[] {
	return "listeners" in emitter ? emitter.listeners(name) : [];
}

export function listenerCount(emitter: Emitter, name: string): number {
	return emitter.listenerCount(name);
}

export function addAbortListener(signal: AbortSignal, listener: () => void): { [Symbol.dispose](): void } {
	signal.addEventListener("abort", listener, { once: true });
	return { [Symbol.dispose]: () => signal.removeEventListener("abort", listener) };
}

Object.assign(EventEmitter, {
	EventEmitter,
	once,
	on,
	setMaxListeners,
	getMaxListeners,
	getEventListeners,
	listenerCount,
	addAbortListener,
	errorMonitor,
	captureRejectionSymbol,
	captureRejections: false,
});

export default EventEmitter;
