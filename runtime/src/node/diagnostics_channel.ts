// node:diagnostics_channel: channels with no subscribers.

class Channel {
	readonly name: string;
	hasSubscribers = false;
	constructor(name: string) {
		this.name = name;
	}
	publish(): void {}
	subscribe(): void {}
	unsubscribe(): boolean {
		return false;
	}
	bindStore(): void {}
	unbindStore(): void {}
	runStores<R>(_data: unknown, fn: (...args: unknown[]) => R, thisArg?: unknown, ...args: unknown[]): R {
		return fn.apply(thisArg, args);
	}
}

const channels = new Map<string, Channel>();

export function channel(name: string): Channel {
	let existing = channels.get(name);
	if (!existing) {
		existing = new Channel(name);
		channels.set(name, existing);
	}
	return existing;
}
export function hasSubscribers(): boolean {
	return false;
}
export function subscribe(): void {}
export function unsubscribe(): boolean {
	return false;
}
export function tracingChannel(name: string) {
	return {
		start: channel(`tracing:${name}:start`),
		end: channel(`tracing:${name}:end`),
		asyncStart: channel(`tracing:${name}:asyncStart`),
		asyncEnd: channel(`tracing:${name}:asyncEnd`),
		error: channel(`tracing:${name}:error`),
		hasSubscribers: false,
		subscribe() {},
		unsubscribe() {},
		traceSync: <R>(fn: (...args: unknown[]) => R, _ctx?: unknown, thisArg?: unknown, ...args: unknown[]) =>
			fn.apply(thisArg, args),
		tracePromise: <R>(fn: (...args: unknown[]) => R, _ctx?: unknown, thisArg?: unknown, ...args: unknown[]) =>
			fn.apply(thisArg, args),
		traceCallback: <R>(fn: (...args: unknown[]) => R, _pos?: number, _ctx?: unknown, thisArg?: unknown, ...args: unknown[]) =>
			fn.apply(thisArg, args),
	};
}
export { Channel };

export default { channel, hasSubscribers, subscribe, unsubscribe, tracingChannel, Channel };
