// node:dns: name resolution happens inside URLSession.
import { unsupported } from "./unsupported.ts";

export const lookup = unsupported("dns.lookup");
export const resolve = unsupported("dns.resolve");
export const promises = { lookup: unsupported("dns.promises.lookup"), resolve: unsupported("dns.promises.resolve") };
export function setDefaultResultOrder(): void {}
export function getDefaultResultOrder(): string {
	return "verbatim";
}

export default { lookup, resolve, promises, setDefaultResultOrder, getDefaultResultOrder };
