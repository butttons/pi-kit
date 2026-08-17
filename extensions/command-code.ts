/**
 * command-code provider extension
 *
 * Registers the Command Code provider API (https://commandcode.ai/provider)
 * as two pi providers: "command-code" for OpenAI-compatible models and
 * "command-code-anthropic" for Claude models (Anthropic Messages shape).
 * The model list is fetched live at startup; the API key is read from the
 * "command-code" entry in pi auth (~/.pi/agent/auth.json).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "command-code";
const ANTHROPIC_PROVIDER = "command-code-anthropic";
const BASE_URL = "https://api.commandcode.ai/provider";
const MODELS_URL = BASE_URL + "/v1/models";

type ProviderModel = {
	id: string;
	name?: string;
	context_length?: number;
};

type ModelsResponse = {
	data: ProviderModel[];
};

async function readApiKey(): Promise<string | null> {
	try {
		const raw = await readFile(join(homedir(), ".pi/agent/auth.json"), "utf8");
		const auth = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
		const entry = auth[PROVIDER];
		return entry && entry.type === "api_key" && entry.key ? entry.key : null;
	} catch {
		return null;
	}
}

export default async function (pi: ExtensionAPI) {
	const apiKey = await readApiKey();
	if (!apiKey) {
		console.error(PROVIDER + ': no API key in pi auth, provider not registered. Add it via /login or auth.json under "' + PROVIDER + '".');
		return;
	}

	let response: Response;
	try {
		response = await fetch(MODELS_URL, {
			headers: { Authorization: "Bearer " + apiKey },
		});
	} catch (error) {
		console.error(PROVIDER + ": model list fetch failed: " + (error instanceof Error ? error.message : String(error)));
		return;
	}
	if (!response.ok) {
		console.error(PROVIDER + ": model list fetch failed: HTTP " + response.status);
		return;
	}

	const payload = (await response.json()) as ModelsResponse;
	const isClaude = (model: ProviderModel) => model.id.startsWith("claude");
	const hasImageInput = (model: ProviderModel) =>
		isClaude(model) || model.id.startsWith("gpt-") || model.id.startsWith("google/");
	const hasReasoning = (model: ProviderModel) =>
		isClaude(model) || model.id.startsWith("gpt-") || model.id.startsWith("xai/");

	const toModelConfig = (model: ProviderModel) => ({
		id: model.id,
		name: model.name ?? model.id,
		reasoning: hasReasoning(model),
		input: (hasImageInput(model) ? ["text", "image"] : ["text"]) as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.context_length ?? 128000,
		maxTokens: 16384,
	});

	pi.registerProvider(PROVIDER, {
		name: "Command Code",
		baseUrl: BASE_URL + "/v1",
		apiKey,
		api: "openai-completions",
		models: payload.data.filter((model) => !isClaude(model)).map(toModelConfig),
	});

	pi.registerProvider(ANTHROPIC_PROVIDER, {
		name: "Command Code (Anthropic)",
		baseUrl: BASE_URL,
		apiKey,
		api: "anthropic-messages",
		models: payload.data.filter(isClaude).map(toModelConfig),
	});
}
