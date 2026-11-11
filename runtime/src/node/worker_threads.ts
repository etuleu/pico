// node:worker_threads: single-threaded host; callers fall back to in-thread work.
import { EventEmitter } from "./events.ts";
import { UnsupportedClass } from "./unsupported.ts";

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;
export const resourceLimits = {};
export const SHARE_ENV = Symbol("SHARE_ENV");
export class Worker extends UnsupportedClass {}
export class MessageChannel {
	port1 = new EventEmitter();
	port2 = new EventEmitter();
}
export class MessagePort extends EventEmitter {}
export class BroadcastChannel extends EventEmitter {}
export function markAsUntransferable(): void {}
export function receiveMessageOnPort(): undefined {
	return undefined;
}
export function setEnvironmentData(): void {}
export function getEnvironmentData(): undefined {
	return undefined;
}

export default {
	isMainThread,
	parentPort,
	workerData,
	threadId,
	resourceLimits,
	SHARE_ENV,
	Worker,
	MessageChannel,
	MessagePort,
	BroadcastChannel,
	markAsUntransferable,
	receiveMessageOnPort,
	setEnvironmentData,
	getEnvironmentData,
};
