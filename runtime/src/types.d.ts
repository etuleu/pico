// Ambient declarations for untyped shim dependencies.
declare module "readable-stream" {
	import stream = require("node:stream");
	export = stream;
}

declare module "path-browserify" {
	import path = require("node:path");
	export = path;
}
