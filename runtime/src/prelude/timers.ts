// Node-style timers on top of host timers. Returned Timeout objects support ref/unref/refresh like Node's.
import { host } from "../host.ts";

export class Timeout {
	readonly _callback: () => void;
	readonly _ms: number;
	readonly _repeat: boolean;
	_id: number;
	_refed = true;
	_active = true;

	constructor(callback: () => void, ms: number, repeat: boolean) {
		this._callback = callback;
		this._ms = Math.max(0, Number(ms) || 0);
		this._repeat = repeat;
		this._id = 0;
		this._schedule();
		liveTimers.add(this);
	}

	_schedule(): void {
		this._id = host.setTimer(this._ms, () => {
			if (!this._active) return;
			if (this._repeat) this._schedule();
			else this._clear();
			this._callback();
		});
	}

	_clear(): void {
		this._active = false;
		host.clearTimer(this._id);
		liveTimers.delete(this);
	}

	ref(): this {
		this._refed = true;
		return this;
	}

	unref(): this {
		this._refed = false;
		return this;
	}

	hasRef(): boolean {
		return this._refed;
	}

	refresh(): this {
		if (this._active) {
			host.clearTimer(this._id);
			this._schedule();
		}
		return this;
	}

	close(): this {
		this._clear();
		return this;
	}

	[Symbol.toPrimitive](): number {
		return this._id;
	}
}

const liveTimers = new Set<Timeout>();

type TimerHandle = Timeout | number | undefined | null;

function clear(handle: TimerHandle): void {
	if (handle == null) return;
	if (handle instanceof Timeout) {
		handle._clear();
		return;
	}
	for (const timer of liveTimers) {
		if (timer._id === handle) {
			timer._clear();
			return;
		}
	}
}

export function setTimeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
	return new Timeout(() => callback(...args), ms ?? 0, false);
}

export function setInterval(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
	return new Timeout(() => callback(...args), ms ?? 0, true);
}

export function setImmediate(callback: (...args: unknown[]) => void, ...args: unknown[]): Timeout {
	return new Timeout(() => callback(...args), 0, false);
}

export const clearTimeout = clear;
export const clearInterval = clear;
export const clearImmediate = clear;

export function queueMicrotask(callback: () => void): void {
	Promise.resolve()
		.then(callback)
		.catch((error) => {
			globalThis.reportError?.(error);
		});
}

export function installTimers(): void {
	Object.assign(globalThis, {
		setTimeout,
		setInterval,
		setImmediate,
		clearTimeout,
		clearInterval,
		clearImmediate,
		queueMicrotask,
	});
}
