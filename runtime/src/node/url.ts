// node:url
import { posix } from "./path.ts";

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

export function fileURLToPath(url: string | URL): string {
	const parsed = typeof url === "string" ? new globalThis.URL(url) : url;
	if (parsed.protocol !== "file:") throw new TypeError("The URL must be of scheme file");
	return decodeURIComponent(parsed.pathname);
}

export function pathToFileURL(path: string): URL {
	const absolute = posix.resolve(path);
	const encoded = absolute
		.split("/")
		.map((part: string) => encodeURIComponent(part))
		.join("/");
	return new globalThis.URL(`file://${encoded}${path.endsWith("/") && !encoded.endsWith("/") ? "/" : ""}`);
}

export function format(url: URL | string | Record<string, unknown>): string {
	if (typeof url === "string") return url;
	if (url instanceof globalThis.URL) return url.href;
	const protocol = url.protocol ? `${String(url.protocol).replace(/:$/, "")}:` : "";
	const host = url.host ?? `${url.hostname ?? ""}${url.port ? `:${url.port}` : ""}`;
	return `${protocol}${url.slashes || protocol ? "//" : ""}${host}${url.pathname ?? ""}${url.search ?? ""}${url.hash ?? ""}`;
}

export function parse(input: string): Record<string, string | null> {
	try {
		const url = new globalThis.URL(input);
		return {
			protocol: url.protocol,
			host: url.host,
			hostname: url.hostname,
			port: url.port || null,
			pathname: url.pathname,
			search: url.search || null,
			query: url.search.slice(1) || null,
			hash: url.hash || null,
			href: url.href,
			path: url.pathname + url.search,
			auth: url.username ? `${url.username}${url.password ? `:${url.password}` : ""}` : null,
		};
	} catch {
		return { href: input, pathname: input, path: input, protocol: null, host: null, hostname: null };
	}
}

export function resolve(from: string, to: string): string {
	return new globalThis.URL(to, new globalThis.URL(from, "resolve://")).href.replace(/^resolve:\/\//, "");
}

export function domainToASCII(domain: string): string {
	return domain;
}

export default { URL, URLSearchParams, fileURLToPath, pathToFileURL, format, parse, resolve, domainToASCII };
