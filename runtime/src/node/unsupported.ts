// Helpers for modules that exist on Node but not on this host.

export function unsupported(name: string): (...args: unknown[]) => never {
	return () => {
		const error = new Error(`${name} is not supported on this platform`) as Error & { code: string };
		error.code = "ERR_NOT_SUPPORTED";
		throw error;
	};
}

export class UnsupportedClass {
	constructor() {
		throw new Error(`${new.target.name} is not supported on this platform`);
	}
}
