// Modules owned by the prelude bundle and shared with the main bundle.
import type * as BufferModule from "buffer";
import type EventEmitterClass from "events";
import type * as StreamModule from "readable-stream";
import type * as StringDecoderModule from "string_decoder";

interface SharedModules {
	buffer: typeof BufferModule;
	events: typeof EventEmitterClass;
	stream: typeof StreamModule;
	string_decoder: typeof StringDecoderModule;
}

export const shared = (globalThis as unknown as { __picoModules: SharedModules }).__picoModules;
