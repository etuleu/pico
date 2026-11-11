// `process` package used by readable-stream inside the prelude, before the global exists: resolve lazily.
// CommonJS so that `require("process/")` returns the proxy itself.
module.exports = new Proxy(
	{},
	{
		get: (_target, key) => globalThis.process[key],
	},
);
