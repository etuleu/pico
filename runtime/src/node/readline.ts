// node:readline: line splitting over a Readable, which is what pi uses it for.
import { EventEmitter } from "events";
import type { Readable } from "readable-stream";

interface InterfaceOptions {
	input: Readable | NodeJS.ReadableStream;
	output?: unknown;
	terminal?: boolean;
	crlfDelay?: number;
}

export class Interface extends EventEmitter {
	private buffer = "";
	private closed = false;
	private readonly input: Readable;
	private readonly onData: (chunk: string | Uint8Array) => void;
	private readonly onEnd: () => void;
	private readonly decoder = new TextDecoder();
	terminal = false;
	line = "";

	constructor(options: InterfaceOptions) {
		super();
		this.input = options.input as Readable;
		this.onData = (chunk) => {
			this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
			let index = this.buffer.search(/\r?\n/);
			while (index !== -1) {
				const line = this.buffer.slice(0, index);
				const newlineLength = this.buffer[index] === "\r" ? 2 : 1;
				this.buffer = this.buffer.slice(index + newlineLength);
				this.emit("line", line);
				index = this.buffer.search(/\r?\n/);
			}
		};
		this.onEnd = () => {
			this.buffer += this.decoder.decode();
			if (this.buffer.length) this.emit("line", this.buffer);
			this.buffer = "";
			this.close();
		};
		this.input.on("data", this.onData);
		this.input.on("end", this.onEnd);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.input.off("data", this.onData);
		this.input.off("end", this.onEnd);
		this.emit("close");
	}

	pause(): this {
		this.input.pause();
		return this;
	}

	resume(): this {
		this.input.resume();
		return this;
	}

	setPrompt(): void {}
	prompt(): void {}
	write(): void {}

	question(_query: string, callback: (answer: string) => void): void {
		this.once("line", callback);
	}

	async *[Symbol.asyncIterator](): AsyncIterableIterator<string> {
		const lines: string[] = [];
		let wake: (() => void) | undefined;
		const onLine = (line: string) => {
			lines.push(line);
			wake?.();
		};
		this.on("line", onLine);
		this.once("close", () => wake?.());
		try {
			while (true) {
				if (lines.length) {
					yield lines.shift() as string;
					continue;
				}
				if (this.closed) return;
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
				wake = undefined;
			}
		} finally {
			this.off("line", onLine);
		}
	}
}

export function createInterface(options: InterfaceOptions | Readable, output?: unknown): Interface {
	const opts = "input" in (options as object) ? (options as InterfaceOptions) : { input: options as Readable, output };
	return new Interface(opts);
}

export function emitKeypressEvents(): void {}
export function clearLine(): boolean {
	return true;
}
export function clearScreenDown(): boolean {
	return true;
}
export function cursorTo(): boolean {
	return true;
}
export function moveCursor(): boolean {
	return true;
}

export const promises = { createInterface, Interface };

export default { Interface, createInterface, emitKeypressEvents, clearLine, clearScreenDown, cursorTo, moveCursor, promises };
