// Web tools for agents: `perplexity_search` (Perplexity Search API: ranked results with titles, URLs, snippets) and
// `fetch` (a web page as Markdown). They are not offered to the main conversation; agents list them in their files.
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { num, obj, opt, str } from "@earendil-works/pi-schema";
import TurndownService from "turndown";

const MAX_FETCH_CHARS = 40_000;

function text(value: string) {
	return { output: [{ type: "text" as const, text: value }] };
}

function failure(value: string) {
	return { output: [{ type: "text" as const, text: value }], isError: true };
}

interface SearchResult {
	title?: string;
	url?: string;
	snippet?: string;
	date?: string;
	last_updated?: string;
}

const perplexitySearch = defineTool({
	name: "perplexity_search",
	description:
		"Search the web with Perplexity. Returns ranked results with title, URL, date and a text snippet. Use several focused queries rather than one broad one.",
	parameters: obj({
		query: str({ description: "Search query" }),
		max_results: opt(num({ description: "Number of results, 1 to 20 (default 8)" })),
	}),
	replay: "safe",
	execute: async (args, _api, context) => {
		const key = process.env.PERPLEXITY_API_KEY;
		if (!key) return failure("PERPLEXITY_API_KEY is not set. Add a Perplexity API key in Settings.");
		const response = await fetch("https://api.perplexity.ai/search", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ query: args.query, max_results: Math.min(20, Math.max(1, args.max_results ?? 8)) }),
			signal: context.abortSignal,
		});
		if (!response.ok) return failure(`Perplexity search failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
		const body = (await response.json()) as { results?: SearchResult[] };
		const results = body.results ?? [];
		if (results.length === 0) return text("No results.");
		return text(
			results
				.map((result, index) => {
					const date = result.date ?? result.last_updated;
					return `${index + 1}. ${result.title ?? "(untitled)"}\n   ${result.url ?? ""}${date ? `\n   ${date}` : ""}\n   ${(result.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 1200)}`;
				})
				.join("\n\n"),
		);
	},
});

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe", "nav", "footer"]);
turndown.remove((node) => node.nodeName === "SVG" || node.nodeName === "svg");

const fetchPage = defineTool({
	name: "fetch",
	description: `Fetch a web page and return its content as Markdown (truncated to ${MAX_FETCH_CHARS} characters). Use for pages found by search.`,
	parameters: obj({ url: str({ description: "http(s) URL" }) }),
	replay: "safe",
	execute: async (args, _api, context) => {
		if (!/^https?:\/\//.test(args.url)) return failure("Only http(s) URLs can be fetched.");
		const response = await fetch(args.url, {
			headers: { "User-Agent": "Mozilla/5.0 (iPhone) pico", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
			signal: context.abortSignal,
		});
		if (!response.ok) return failure(`Fetch failed: ${response.status} ${response.statusText}`);
		const type = response.headers.get("content-type") ?? "";
		const body = await response.text();
		let content = body;
		if (type.includes("html")) {
			const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
			content = `${title ? `# ${title}\n\n` : ""}${turndown.turndown(body)}`;
		}
		content = content.replace(/\n{3,}/g, "\n\n").trim();
		const truncated = content.length > MAX_FETCH_CHARS;
		return text(`${response.url}\n\n${content.slice(0, MAX_FETCH_CHARS)}${truncated ? "\n\n[truncated]" : ""}`);
	},
});

export const WebTools = defineExtension({ name: "pico-web", tools: [perplexitySearch, fetchPage] });
