// node:tty: nothing is a TTY on this host.
import { EventEmitter } from "./events.ts";

export function isatty(): boolean {
	return false;
}
export class ReadStream extends EventEmitter {
	isTTY = false;
	setRawMode(): this {
		return this;
	}
}
export class WriteStream extends EventEmitter {
	isTTY = false;
	columns = 120;
	rows = 40;
	getColorDepth(): number {
		return 1;
	}
	hasColors(): boolean {
		return false;
	}
}

export default { isatty, ReadStream, WriteStream };
