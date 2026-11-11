// node:net / node:tls / node:dgram: raw sockets are not available to the agent runtime.
import { EventEmitter } from "./events.ts";
import { unsupported } from "./unsupported.ts";

export class Socket extends EventEmitter {
	constructor() {
		super();
		unsupported("net.Socket")();
	}
}
export class Server extends EventEmitter {}
export const createServer = unsupported("net.createServer");
export const createConnection = unsupported("net.createConnection");
export const connect = unsupported("net.connect");
export const createSecureContext = unsupported("tls.createSecureContext");
export const createSocket = unsupported("dgram.createSocket");
export const TLSSocket = Socket;
export const rootCertificates: string[] = [];
export const DEFAULT_MIN_VERSION = "TLSv1.2";
export const DEFAULT_MAX_VERSION = "TLSv1.3";
export function isIP(input: string): number {
	return isIPv4(input) ? 4 : isIPv6(input) ? 6 : 0;
}
export function isIPv4(input: string): boolean {
	return /^(\d{1,3}\.){3}\d{1,3}$/.test(input);
}
export function isIPv6(input: string): boolean {
	return input.includes(":") && /^[0-9a-fA-F:.]+$/.test(input);
}
export function getDefaultAutoSelectFamilyAttemptTimeout(): number {
	return 250;
}
export function setDefaultAutoSelectFamilyAttemptTimeout(): void {}
export function setDefaultAutoSelectFamily(): void {}
export function getDefaultAutoSelectFamily(): boolean {
	return true;
}
export class BlockList {
	addAddress(): void {}
	check(): boolean {
		return false;
	}
}
export class SocketAddress {}

export default {
	Socket,
	Server,
	createServer,
	createConnection,
	connect,
	createSecureContext,
	createSocket,
	TLSSocket,
	rootCertificates,
	DEFAULT_MIN_VERSION,
	DEFAULT_MAX_VERSION,
	isIP,
	isIPv4,
	isIPv6,
	getDefaultAutoSelectFamilyAttemptTimeout,
	setDefaultAutoSelectFamilyAttemptTimeout,
	setDefaultAutoSelectFamily,
	getDefaultAutoSelectFamily,
	BlockList,
	SocketAddress,
};
