// node:v8, node:vm, node:sqlite, node:inspector, node:cluster: unavailable.
import { unsupported, UnsupportedClass } from "./unsupported.ts";

export function getHeapStatistics() {
	return { total_heap_size: 0, used_heap_size: 0, heap_size_limit: 4 * 1024 ** 3 };
}
export function getHeapSpaceStatistics(): unknown[] {
	return [];
}
export function setFlagsFromString(): void {}
export const serialize = unsupported("v8.serialize");
export const deserialize = unsupported("v8.deserialize");
export const writeHeapSnapshot = unsupported("v8.writeHeapSnapshot");
export const startupSnapshot = { isBuildingSnapshot: () => false };

export class Script extends UnsupportedClass {}
export const runInNewContext = unsupported("vm.runInNewContext");
export const runInThisContext = unsupported("vm.runInThisContext");
export const runInContext = unsupported("vm.runInContext");
export const createContext = unsupported("vm.createContext");
export const compileFunction = unsupported("vm.compileFunction");
export function isContext(): boolean {
	return false;
}
export const constants = {};

export class DatabaseSync extends UnsupportedClass {}
export class StatementSync extends UnsupportedClass {}

export const isPrimary = true;
export const isMaster = true;
export const isWorker = false;
export function url(): undefined {
	return undefined;
}
export class Session extends UnsupportedClass {}
export const open = unsupported("inspector.open");
export function close(): void {}

export default {
	getHeapStatistics,
	getHeapSpaceStatistics,
	setFlagsFromString,
	serialize,
	deserialize,
	writeHeapSnapshot,
	startupSnapshot,
	Script,
	runInNewContext,
	runInThisContext,
	runInContext,
	createContext,
	compileFunction,
	isContext,
	constants,
	DatabaseSync,
	StatementSync,
	isPrimary,
	isMaster,
	isWorker,
	url,
	Session,
	open,
	close,
};
