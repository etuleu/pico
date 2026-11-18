// Prints a pi models.json `deepinfra` provider with DeepInfra's featured chat models that support tools.
// Usage: DEEPINFRA_API_KEY=... node scripts/deepinfra-featured.mjs [--priority] > models.json
// Prices: DeepInfra reports cents per token; pi uses dollars per million tokens (cents * 10_000).
// --priority: request DeepInfra's priority service tier (front of the queue under load, 1.5x price) on models that
// support it, via pi's `samplingParams`, and list their prices at 1.5x so pico's cost display stays right.
// https://deepinfra.com/blog/priority-service-tier
const response = await fetch("https://api.deepinfra.com/models/featured", {
	headers: process.env.DEEPINFRA_API_KEY ? { Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}` } : {},
});
if (!response.ok) throw new Error(`DeepInfra: ${response.status} ${await response.text()}`);
const featured = await response.json();

const priority = process.argv.includes("--priority");
const perMillion = (cents) => (typeof cents === "number" ? cents * 10_000 : 0);
const round = (n) => Math.round(n * 1000) / 1000;

const models = featured
	.filter((m) => m.type === "text-generation" && m.tags?.includes("tools") && !m.deprecated)
	.map((m) => {
		const tier = priority && m.tags.includes("priority");
		const rate = tier ? (m.pricing?.rate_per_service_tier_priority ?? 1.5) : 1;
		const input = round(perMillion(m.pricing?.cents_per_input_token) * rate);
		const cached = m.pricing?.rate_per_input_token_cached;
		return {
			id: m.model_name,
			name: m.model_name.split("/").pop(),
			reasoning: m.tags.includes("reasoning"),
			input: m.tags.includes("multimodal") ? ["text", "image"] : ["text"],
			contextWindow: m.max_tokens ?? 131072,
			maxTokens: Math.min(32768, m.max_tokens ?? 32768),
			cost: {
				input,
				output: round(perMillion(m.pricing?.cents_per_output_token) * rate),
				cacheRead: typeof cached === "number" ? round(input * cached) : 0,
				cacheWrite: 0,
			},
			...(tier ? { samplingParams: { service_tier: "priority" } } : {}),
		};
	});

console.log(
	JSON.stringify(
		{
			providers: {
				deepinfra: {
					baseUrl: "https://api.deepinfra.com/v1/openai",
					api: "openai-completions",
					apiKey: "$DEEPINFRA_API_KEY",
					models,
				},
			},
		},
		null,
		2,
	),
);
