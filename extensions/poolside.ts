/**
 * poolside provider extension
 *
 * Registers the Poolside inference API (https://poolside.ai)
 * as a pi provider: "poolside" for OpenAI-compatible chat models.
 *
 * The model list is fetched live at startup; the API key is read
 * from the "poolside" entry in pi auth (~/.pi/agent/auth.json).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "poolside";
const BASE_URL = "https://inference.poolside.ai/v1";
const MODELS_URL = BASE_URL + "/models";

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
		const raw = await readFile(join(homedir(), ".pi/agent/auth.json"), "utf-8");
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

	const toModelConfig = (model: ProviderModel) => ({
		id: model.id,
		name: model.name ?? model.id,
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.context_length ?? 128000,
		maxTokens: 16384,
	});

	pi.registerProvider(PROVIDER, {
		name: "Poolside",
		baseUrl: BASE_URL,
		apiKey,
		api: "openai-completions",
		models: payload.data.map(toModelConfig),
	});
}
