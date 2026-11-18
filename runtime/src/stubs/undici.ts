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

/** Socket connectors are not available; dispatchers built with them are ignored by the URLSession-backed fetch. */
export function buildConnector(): (options: unknown, callback: (error: Error | null) => void) => void {
	return (_options, callback) => callback(new Error("undici connectors are not supported on this platform"));
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
	buildConnector,
	fetch,
	Headers,
	Request,
	Response,
	FormData,
	WebSocket,
	interceptors,
};
