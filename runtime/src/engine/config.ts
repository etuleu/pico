// Model configuration: pi-ai's built-in providers plus custom providers from pi's `models.json` format.
// API keys come from the environment (the app injects them from the Keychain), as in pi.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Api,
	type ApiKeyAuth,
	createModels,
	createProvider,
	type Model,
	type MutableModels,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

/** The subset of pi's models.json that pico understands. */
interface ModelsFile {
	providers?: Record<
		string,
		{
			baseUrl?: string;
			api?: string;
			apiKey?: string;
			headers?: Record<string, string>;
			models?: {
				id: string;
				name?: string;
				reasoning?: boolean;
				input?: ("text" | "image")[];
				contextWindow?: number;
				maxTokens?: number;
				cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
			}[];
		}
	>;
}

const apis: Record<string, () => ProviderStreams> = {
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"anthropic-messages": anthropicMessagesApi,
	"google-generative-ai": googleGenerativeAIApi,
	"mistral-conversations": mistralConversationsApi,
};

/** Resolves a models.json value: `$NAME` / `${NAME}` read the environment, anything else is literal. */
function resolveValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const env = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(value);
	if (env) return process.env[env[1]] || undefined;
	return value.replace(/^\$\$/, "$");
}

function apiKeyAuth(provider: string, apiKey: string | undefined): ApiKeyAuth {
	return {
		name: `${provider} API key`,
		resolve: async () => {
			const key = resolveValue(apiKey);
			return key ? { auth: { apiKey: key }, source: "models.json" } : undefined;
		},
	};
}

export function loadModels(agentDir: string, log: (message: string) => void): MutableModels {
	const models = createModels();
	for (const provider of builtinProviders()) models.setProvider(provider);

	const path = join(agentDir, "models.json");
	if (!existsSync(path)) return models;
	let file: ModelsFile;
	try {
		file = JSON.parse(readFileSync(path, "utf8") as string) as ModelsFile;
	} catch (error) {
		log(`models.json: ${(error as Error).message}`);
		return models;
	}
	for (const [id, config] of Object.entries(file.providers ?? {})) {
		const api = config.api ?? "openai-completions";
		const streams = apis[api];
		if (!streams) {
			log(`models.json: provider ${id}: unsupported api ${api}`);
			continue;
		}
		if (!config.baseUrl || !config.models?.length) {
			log(`models.json: provider ${id}: baseUrl and models are required`);
			continue;
		}
		const providerModels: Model<Api>[] = config.models.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			api,
			provider: id,
			baseUrl: config.baseUrl as string,
			input: model.input ?? ["text"],
			reasoning: model.reasoning ?? false,
			contextWindow: model.contextWindow ?? 128_000,
			maxTokens: model.maxTokens ?? 16_384,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...model.cost },
			headers: config.headers,
		}));
		models.setProvider(
			createProvider({
				id,
				baseUrl: config.baseUrl,
				auth: { apiKey: apiKeyAuth(id, config.apiKey) },
				api: streams(),
				models: providerModels,
			}),
		);
	}
	return models;
}

/** pi's settings.json fields pico reads. */
export interface Settings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: string;
}

export function loadSettings(agentDir: string): Settings {
	try {
		return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8") as string) as Settings;
	} catch {
		return {};
	}
}
