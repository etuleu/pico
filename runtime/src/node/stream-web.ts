// node:stream/web: the global web streams installed by the prelude.
export const ReadableStream = globalThis.ReadableStream;
export const WritableStream = globalThis.WritableStream;
export const TransformStream = globalThis.TransformStream;
export const TextDecoderStream = globalThis.TextDecoderStream;
export const TextEncoderStream = globalThis.TextEncoderStream;
export const ByteLengthQueuingStrategy = globalThis.ByteLengthQueuingStrategy;
export const CountQueuingStrategy = globalThis.CountQueuingStrategy;

export default {
	ReadableStream,
	WritableStream,
	TransformStream,
	TextDecoderStream,
	TextEncoderStream,
	ByteLengthQueuingStrategy,
	CountQueuingStrategy,
};
