// undici stub: pi configures undici's global dispatcher; on this host, fetch is URLSession-backed.
import { EventEmitter } from "../node/events.ts";

export class Dispatcher extends EventEmitter {
	readonly options: unknown;
	constructor(options?: unknown) {
		super();
		this.options = options;
	}
	close(): Promise<void> {
		return Promise.resolve();
	}
	destroy(): Promise<void> {
		return Promise.resolve();
	}
	compose(): this {
		return this;
	}
}
export class Agent extends Dispatcher {}
export class EnvHttpProxyAgent extends Dispatcher {}
export class ProxyAgent extends Dispatcher {}
export class Pool extends Dispatcher {}
export class Client extends Dispatcher {}
export class RetryAgent extends Dispatcher {}

let globalDispatcher: Dispatcher = new Agent();

export function setGlobalDispatcher(dispatcher: Dispatcher): void {
	globalDispatcher = dispatcher;
}
export function getGlobalDispatcher(): Dispatcher {
	return globalDispatcher;
}

export const fetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args);
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export const WebSocket = undefined;
export const interceptors = {};

export default {
	Dispatcher,
	Agent,
	EnvHttpProxyAgent,
	ProxyAgent,
	Pool,
	Client,
	RetryAgent,
	setGlobalDispatcher,
	getGlobalDispatcher,
	fetch,
	Headers,
	Request,
	Response,
	FormData,
	WebSocket,
	interceptors,
};
