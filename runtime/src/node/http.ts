// node:http / node:https / node:http2: outbound HTTP goes through fetch; servers are unavailable.
import { EventEmitter } from "./events.ts";
import { unsupported } from "./unsupported.ts";

export class Agent extends EventEmitter {
	readonly options: unknown;
	constructor(options?: unknown) {
		super();
		this.options = options;
	}
	destroy(): void {}
}
export const globalAgent = new Agent();
export class Server extends EventEmitter {}
export class IncomingMessage extends EventEmitter {}
export class ServerResponse extends EventEmitter {}
export class ClientRequest extends EventEmitter {}
export class OutgoingMessage extends EventEmitter {}
export const createServer = unsupported("http.createServer");
export const createSecureServer = unsupported("http2.createSecureServer");
export const request = unsupported("http.request");
export const get = unsupported("http.get");
export const connect = unsupported("http2.connect");
export const METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"];
export const STATUS_CODES: Record<number, string> = { 200: "OK", 400: "Bad Request", 404: "Not Found", 500: "Internal Server Error" };
export const constants = {};
export const maxHeaderSize = 16384;
export function validateHeaderName(): void {}
export function validateHeaderValue(): void {}

export default {
	Agent,
	globalAgent,
	Server,
	IncomingMessage,
	ServerResponse,
	ClientRequest,
	OutgoingMessage,
	createServer,
	createSecureServer,
	request,
	get,
	connect,
	METHODS,
	STATUS_CODES,
	constants,
	maxHeaderSize,
	validateHeaderName,
	validateHeaderValue,
};
