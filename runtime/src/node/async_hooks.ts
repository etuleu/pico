// node:async_hooks. AsyncLocalStorage only tracks synchronous scopes (no async context propagation in JSC).

export class AsyncLocalStorage<T> {
	private store: T | undefined;

	getStore(): T | undefined {
		return this.store;
	}

	run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
		const previous = this.store;
		this.store = store;
		try {
			return callback(...args);
		} finally {
			this.store = previous;
		}
	}

	exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
		return this.run(undefined as T, callback, ...args);
	}

	enterWith(store: T): void {
		this.store = store;
	}

	disable(): void {
		this.store = undefined;
	}

	static bind<F>(fn: F): F {
		return fn;
	}

	static snapshot(): <R>(fn: (...args: unknown[]) => R, ...args: unknown[]) => R {
		return (fn, ...args) => fn(...args);
	}
}

export class AsyncResource {
	readonly type: string;
	constructor(type: string) {
		this.type = type;
	}
	runInAsyncScope<R>(fn: (...args: unknown[]) => R, thisArg?: unknown, ...args: unknown[]): R {
		return fn.apply(thisArg, args);
	}
	bind<F>(fn: F): F {
		return fn;
	}
	emitDestroy(): this {
		return this;
	}
	static bind<F>(fn: F): F {
		return fn;
	}
}

export function createHook(): { enable(): void; disable(): void } {
	return { enable() {}, disable() {} };
}
export function executionAsyncId(): number {
	return 0;
}
export function triggerAsyncId(): number {
	return 0;
}

export default { AsyncLocalStorage, AsyncResource, createHook, executionAsyncId, triggerAsyncId };
