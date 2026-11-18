// Prints a pi models.json `deepinfra` provider with DeepInfra's featured chat models that support tools.
// Usage: DEEPINFRA_API_KEY=... node scripts/deepinfra-featured.mjs > provider.json
// Prices: DeepInfra reports cents per token; pi uses dollars per million tokens (cents * 10_000).
const response = await fetch("https://api.deepinfra.com/models/featured", {
	headers: process.env.DEEPINFRA_API_KEY ? { Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}` } : {},
});
if (!response.ok) throw new Error(`DeepInfra: ${response.status} ${await response.text()}`);
const featured = await response.json();

const perMillion = (cents) => (typeof cents === "number" ? Math.round(cents * 10_000 * 1000) / 1000 : 0);

const models = featured
	.filter((m) => m.type === "text-generation" && m.tags?.includes("tools") && !m.deprecated)
	.map((m) => {
		const input = perMillion(m.pricing?.cents_per_input_token);
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
				output: perMillion(m.pricing?.cents_per_output_token),
				cacheRead: typeof cached === "number" ? Math.round(input * cached * 1000) / 1000 : 0,
				cacheWrite: 0,
			},
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
