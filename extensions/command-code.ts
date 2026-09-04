/**
 * command-code provider extension
 *
 * Registers the Command Code provider API (https://commandcode.ai/provider)
 * as two pi providers: "command-code" for OpenAI-compatible models and
 * "command-code-anthropic" for Claude models (Anthropic Messages shape).
 * The model list is fetched live at startup; the API key is read from the
 * "command-code" entry in pi auth (~/.pi/agent/auth.json).
 *
 * Capability metadata (thinkingLevelMap, compat) comes from pi's own bundled
 * registry (@earendil-works/pi-ai dist/providers/data) — command-code serves
 * the same weights as zai / opencode-go / anthropic, so those entries are
 * the reference. reasoning_effort knob verified upstream 2026-09-03.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "command-code";
const ANTHROPIC_PROVIDER = "command-code-anthropic";
const BASE_URL = "https://api.commandcode.ai/provider";
const MODELS_URL = BASE_URL + "/v1/models";

type ProviderModel = {
	id: string;
	name?: string;
	context_length?: number;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	compat?: Record<string, unknown>;
	thinkingLevelMap?: Partial<Record<string, string | null>>;
};

type ModelsResponse = {
	data: ProviderModel[];
};

type RegistryModel = {
	id: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	compat?: Record<string, unknown>;
	thinkingLevelMap?: Partial<Record<string, string | null>> | null;
};

async function loadRegistry(provider: string, section: string): Promise<Record<string, RegistryModel>> {
	// Locate the running pi's bundled @earendil-works/pi-ai data dir (same
	// lookup strategy as exe-gateway.ts).
	const candidates: string[] = [];
	try {
		const req = createRequire(import.meta.url);
		candidates.push(join(dirname(req.resolve("@earendil-works/pi-ai/package.json")), "dist/providers/data", provider + ".json"));
	} catch {}
	for (const path of candidates) {
		try {
			const data = JSON.parse(await readFile(path, "utf8")) as Record<string, Record<string, RegistryModel>>;
			if (data[section]) return data[section];
		} catch {}
	}
	return {};
}

function stripPrefix(id: string): string {
	return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

// Capability reference lookup: exact id, then prefix-stripped, then the base
// model family (e.g. "glm-5.3-flash" -> "glm-5.3", "glm-5.2-flash" ->
// "glm-5.2-highspeed") per registry. Variant suffixes served by command-code
// often aren't in pi's registry, but share the base model's capabilities.
function resolveCandidates(id: string): string[] {
	const bare = stripPrefix(id);
	const candidates = [id, bare];
	const base = bare.match(/^(glm-[\d.]+)-/);
	if (base) {
		candidates.push(base[1], base[1] + "-highspeed");
	}
	return candidates;
}

function resolveCapabilities(id: string, ...registries: Record<string, RegistryModel>[]): Pick<ProviderModel, "reasoning" | "input" | "compat" | "thinkingLevelMap"> { // prettier-ignore
	const candidates = resolveCandidates(id);
	for (const reg of registries) {
		for (const cand of candidates) {
			const hit = reg[cand];
			if (hit) return { reasoning: hit.reasoning, input: hit.input, compat: hit.compat, thinkingLevelMap: hit.thinkingLevelMap ?? undefined };
		}
	}
	return {};
}

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
	const [apiKey, ocgRegistry, zaiRegistry, anthropicRegistry] = await Promise.all([
		readApiKey(),
		loadRegistry("opencode-go", "openai-completions"),
		loadRegistry("zai", "openai-completions"),
		loadRegistry("anthropic", "anthropic-messages"),
	]);
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

	const toModelConfig = (model: ProviderModel) => {
		const caps = resolveCapabilities(model.id, isClaude(model) ? anthropicRegistry : ocgRegistry, zaiRegistry);
		return {
			id: model.id,
			name: model.name ?? model.id,
			reasoning: caps.reasoning ?? false,
			input: (caps.input ?? ["text"]) as ("text" | "image")[],
			compat: caps.compat,
			thinkingLevelMap: caps.thinkingLevelMap,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.context_length ?? 128000,
			maxTokens: 16384,
		};
	};

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
