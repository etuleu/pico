// node:stream: the prelude's readable-stream copy, plus stream/promises and stream/web.
import { shared } from "../shared.ts";

const stream = shared.stream;

export const {
	Readable,
	Writable,
	Duplex,
	Transform,
	PassThrough,
	Stream,
	pipeline,
	finished,
	addAbortSignal,
	compose,
	isDisturbed,
	isErrored,
	isReadable,
	duplexPair,
} = stream as typeof stream & Record<string, never>;
export const promises = stream.promises;
export function getDefaultHighWaterMark(): number {
	return 16 * 1024;
}
export function setDefaultHighWaterMark(): void {}

export default stream;
