// node:console
export const Console = class {
	constructor() {
		// biome-ignore lint/correctness/noConstructorReturn: Console instances share the host console
		return globalThis.console;
	}
};
export default Object.assign(globalThis.console, { Console });
