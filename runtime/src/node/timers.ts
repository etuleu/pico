// node:timers and node:timers/promises. Uses the globals installed by the prelude (one timer table).

export const setTimeout = globalThis.setTimeout;
export const setInterval = globalThis.setInterval;
export const setImmediate = globalThis.setImmediate;
export const clearTimeout = globalThis.clearTimeout;
export const clearInterval = globalThis.clearInterval;
export const clearImmediate = globalThis.clearImmediate;
const timers = { setTimeout, clearTimeout };

function abortError(signal: AbortSignal): unknown {
	return signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

function delay<T>(ms: number | undefined, value: T, options?: { signal?: AbortSignal; ref?: boolean }): Promise<T> {
	return new Promise((resolve, reject) => {
		const signal = options?.signal;
		if (signal?.aborted) {
			reject(abortError(signal));
			return;
		}
		const onAbort = () => {
			timers.clearTimeout(timer);
			reject(abortError(signal as AbortSignal));
		};
		const timer = timers.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve(value);
		}, ms);
		if (options?.ref === false) (timer as unknown as { unref(): void }).unref();
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export const promises = {
	setTimeout: delay,
	setImmediate: <T>(value: T, options?: { signal?: AbortSignal }) => delay(0, value, options),
	async *setInterval<T>(ms: number, value: T, options?: { signal?: AbortSignal }) {
		while (true) yield await delay(ms, value, options);
	},
	scheduler: {
		wait: (ms: number, options?: { signal?: AbortSignal }) => delay(ms, undefined, options),
		yield: () => delay(0, undefined),
	},
};

export default { setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate, promises };
