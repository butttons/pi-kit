// exe.dev LLM gateway — keyless on exe VMs (https://llm.int.exe.xyz).
//
// Provider IDs match the local MacBook pi setup so paseo agent profiles
// (opencode-go/..., command-code/..., command-code-anthropic/...,
// kimi-coding/...) work unchanged here.
//
// Model metadata (contextWindow, maxTokens, thinkingLevelMap, compat) is
// resolved from pi's own bundled registry (@earendil-works/pi-ai
// dist/providers/data) — zai + opencode-go for OpenAI-shape models,
// anthropic for Claude. Command-code serves the same weights, so those
// entries are the capability reference. Prefixes are stripped when matching
// (command-code "z-ai/glm-5.3-flash" -> registry "glm-5.3-flash").
// Thinking knob verified upstream 2026-09-03: reasoning_effort=low|max
// changes reasoning output; thinking streams via the `reasoning` field.
// command-code Claude models are plan-gated upstream (MODEL_NOT_IN_PLAN
// until the exe command-code plan includes them); registered anyway.
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const BASE = "https://llm.int.exe.xyz";
const KEYLESS = "exe-keyless"; // gateway injects auth; pi just needs a non-empty key

type RegistryModel = {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
	contextWindow?: number;
	maxTokens?: number;
	compat?: Model<any>["compat"];
	thinkingLevelMap?: Model<any>["thinkingLevelMap"];
	baseUrl?: string;
};

async function loadRegistry(provider: string, section: string): Promise<Record<string, RegistryModel>> {
	// Locate the running pi's bundled @earendil-works/pi-ai data dir.
	// In npm installs argv[1] realpaths to
	//   .../@earendil-works/pi-coding-agent/dist/bundle/cli.js
	// and pi-ai sits in pi-coding-agent's nested node_modules.
	const candidates: string[] = [];
	try {
		const cli = await realpath(process.argv[1]);
		const pkgDir = dirname(dirname(dirname(cli))); // -> @earendil-works/pi-coding-agent
		candidates.push(join(pkgDir, "node_modules/@earendil-works/pi-ai/dist/providers/data", provider + ".json"));
	} catch {}
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

// The gateway's /v1/models returns an empty list (known upstream quirk),
// so fall back to opencode-go's public upstream catalog.
async function fetchIds(url: string, stripPrefixRe: RegExp): Promise<string[] | null> {
	try {
		const res = await fetch(url);
		const data = (await res.json()) as { data?: { id: string }[] };
		const ids = (data.data ?? []).map((m) => m.id.replace(stripPrefixRe, ""));
		return ids.length > 0 ? ids : null;
	} catch {
		return null;
	}
}

async function fetchOpencodeGoIds(): Promise<string[] | null> {
	return (
		(await fetchIds(`${BASE}/opencode-go/v1/models`, /^opencode-go\//)) ??
		(await fetchIds("https://opencode.ai/zen/go/v1/models", /^opencode-go\//))
	);
}

// Context-window overrides from the live command-code model API
// (api.commandcode.ai/provider/v1/models, 2026-09-04) for models with no
// registry metadata. Keyed by lowercase bare id; also corrects stale
// registry values since the same weights share context parity across lanes.
const CONTEXT_OVERRIDES: Record<string, number> = {
	"minimax-m2.5": 200000,
	"minimax-m2.7": 200000,
	"minimax-m3": 1000000,
	"qwen3.6-max-preview": 200000,
	"qwen3.6-plus": 200000,
	"qwen3.7-flash": 1000000,
	"qwen3.7-max": 1000000,
	"qwen3.7-plus": 1000000,
	"qwen3.8-27b": 262144,
	"qwen3.8-flash": 1000000,
	"qwen3.8-max": 1000000,
	"qwen3.8-max-0902": 1000000,
	"claude-fable-5": 1000000,
	"claude-fable-5-1": 1000000,
	"claude-haiku-4-5": 200000,
	"claude-opus-4-7": 1000000,
	"claude-opus-4-8": 1000000,
	"claude-opus-5": 1000000,
	"claude-sonnet-4-6": 1000000,
	"claude-sonnet-5": 1000000,
	"deepseek-v4-flash": 1000000,
	"deepseek-v4-flash-fast": 1000000,
	"deepseek-v4-flash-vision-exp": 1000000,
	"deepseek-v4-pro": 1000000,
	"gemini-3.1-flash-lite": 1000000,
	"gemini-3.5-flash": 1000000,
	"gemini-3.5-flash-lite": 1000000,
	"gemini-3.6-flash": 1000000,
	"gemini-3.7-flash": 1048576,
	"gemini-3.8-flash": 1000000,
	"gpt-5.3-codex": 400000,
	"gpt-5.4": 400000,
	"gpt-5.4-mini": 400000,
	"gpt-5.5": 400000,
	"gpt-5.6-luna": 1050000,
	"gpt-5.6-sol": 1050000,
	"gpt-5.6-terra": 1050000,
	"longcat-2.0:free": 1048576,
	"muse-spark-1.1": 1048576,
	"muse-spark-1.2": 1048576,
	"muse-spark-1.2-contributor": 1048576,
	"muse-spark-1.3": 1048576,
	"muse-spark-1.3-contributor": 1048576,
	"kimi-k2.5": 256000,
	"kimi-k2.6": 256000,
	"kimi-k2.7-code": 256000,
	"kimi-k2.7-code-highspeed": 262000,
	"kimi-k3": 1000000,
	"nemotron-3-ultra-550b-a55b": 1000000,
	"laguna-s-2.1-free": 256000,
	"fugu-ultra": 1000000,
	"step-3.5-flash": 1000000,
	"step-3.7-flash": 256000,
	"hy3-paid": 262144,
	"hy4-preview": 1048576,
	"inkling": 256000,
	"inkling-small": 1000000,
	"grok-4.5": 500000,
	"grok-4.6": 500000,
	"mimo-v2.5": 1000000,
	"mimo-v2.5-pro": 1000000,
	"glm-5.3-flash": 1048576,
	"glm-5": 200000,
	"glm-5.1": 200000,
	"glm-5.2": 1000000,
	"glm-5.2-fast": 1000000,
	"glm-5.3": 1000000,
};

function withDefaults(id: string): RegistryModel {
	return { id, name: id, reasoning: true, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 131072, maxTokens: 8192 };
}

// Display names carry the lane tag so opencode-go vs command-code is
// unambiguous in pickers (IDs must stay clean for profile portability).
function tagName<T extends { name: string; id: string }>(model: T, tag: string): T {
	const base = model.name && model.name !== model.id ? model.name : model.id;
	return { ...model, name: `${base} [${tag}]` };
}

function retarget(model: RegistryModel, baseUrl: string): RegistryModel {
	const { baseUrl: _drop, ...rest } = model;
	return { ...rest, baseUrl };
}

// Fill fields ProviderModelConfig requires but registry entries may omit.
// CONTEXT_OVERRIDES wins over registry values: context parity holds across
// lanes even when pi's bundled registry is stale.
function toConfig(m: RegistryModel): ProviderModelConfig {
	const bareId = m.id.toLowerCase();
	return {
		...m,
		name: m.name ?? m.id,
		reasoning: m.reasoning ?? true,
		input: m.input ?? ["text"],
		cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0, cacheRead: m.cost?.cacheRead ?? 0, cacheWrite: m.cost?.cacheWrite ?? 0 },
		contextWindow: CONTEXT_OVERRIDES[bareId] ?? m.contextWindow ?? 131072,
		maxTokens: m.maxTokens ?? 8192,
	};
}

function stripPrefix(id: string): string {
	return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

// Capability lookup candidates: exact id, prefix-stripped, then each
// dash-truncated base family (e.g. "glm-5.3-flash" -> "glm-5.3",
// "deepseek-v4-flash-fast" -> "deepseek-v4-flash"). Variant suffixes served
// by these providers often aren't in pi's registry, but share the base
// model's capabilities — same weights across providers, only the lane differs.
function resolveCandidates(id: string): string[] {
	const bare = stripPrefix(id);
	const candidates = [id, bare];
	const parts = bare.split("-");
	while (parts.length > 1) {
		parts.pop();
		candidates.push(parts.join("-"));
	}
	return candidates;
}

// Resolve capability metadata: try each candidate across registries in
// order. First hit wins.
function resolveModel(id: string, ...registries: Record<string, RegistryModel>[]): RegistryModel {
	const candidates = resolveCandidates(id);
	for (const reg of registries) {
		for (const cand of candidates) {
			if (reg[cand]) return { ...reg[cand], id };
		}
	}
	return withDefaults(id);
}

// === Easy-to-edit model lists ============================================
// command-code OpenAI-shape (POST /command-code/v1/chat/completions).
// Full `cmd --list-models` catalog minus Claude (2026-09-04, cmd 1.47.0).
// Add an id from `cmd --list-models` and metadata resolves automatically.
const COMMAND_CODE_IDS = [
	// Open Source
	"deepseek/deepseek-v4-pro",
	"deepseek/deepseek-v4-flash",
	"deepseek/deepseek-v4-flash-vision-exp",
	"deepseek/deepseek-v4-flash-fast",
	"moonshotai/kimi-k3",
	"moonshotai/kimi-k2.7-code",
	"moonshotai/kimi-k2.7-code-highspeed",
	"moonshotai/kimi-k2.6",
	"moonshotai/kimi-k2.5",
	"z-ai/glm-5.3-flash",
	"zai-org/glm-5.3",
	"zai-org/glm-5.2",
	"zai-org/glm-5.2-fast",
	"zai-org/glm-5.1",
	"zai-org/glm-5",
	"minimaxai/minimax-m3",
	"minimaxai/minimax-m2.7",
	"minimaxai/minimax-m2.5",
	"xiaomi/mimo-v2.5-pro",
	"xiaomi/mimo-v2.5",
	"qwen/qwen3.8-max-0902",
	"qwen/qwen3.8-max",
	"qwen/qwen3.8-27b",
	"qwen/qwen3.8-flash",
	"qwen/qwen3.7-max",
	"qwen/qwen3.7-plus",
	"qwen/qwen3.7-flash",
	"qwen/qwen3.6-max-preview",
	"qwen/qwen3.6-plus",
	"meituan/longcat-2.0:free",
	"stepfun/step-3.7-flash",
	"stepfun/step-3.5-flash",
	"tencent/hy3-paid",
	"tencent/hy4-preview",
	"nvidia/nemotron-3-ultra-550b-a55b",
	"thinkingmachines/inkling",
	"thinkingmachines/inkling-small",
	"poolside/laguna-s-2.1-free",
	// OpenAI
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.3-codex",
	"gpt-5.4-mini",
	// Google
	"google/gemini-3.8-flash",
	"google/gemini-3.7-flash",
	"google/gemini-3.6-flash",
	"google/gemini-3.5-flash",
	"google/gemini-3.5-flash-lite",
	"google/gemini-3.1-flash-lite",
	// Sakana
	"sakana/fugu-ultra",
	// Meta
	"meta/muse-spark-1.1",
	"meta/muse-spark-1.2",
	"meta/muse-spark-1.2-contributor",
	"meta/muse-spark-1.3",
	"meta/muse-spark-1.3-contributor",
	// xAI
	"xai/grok-4.5",
	"xai/grok-4.6",
];

// command-code Anthropic-shape (POST /command-code/v1/messages, needs
// anthropic-version header). IDs from `cmd --list-models` Anthropic section.
// NOTE: plan-gated upstream until the exe command-code plan includes Claude.
const COMMAND_CODE_ANTHROPIC_IDS = [
	"claude-sonnet-5",
	"claude-sonnet-4-6",
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-haiku-4-5",
];

const KIMI_IDS = ["kimi-for-coding", "k3", "k3-256k"]; // verified via /kimi-code/v1/messages
// =========================================================================

export default async function (pi: ExtensionAPI) {
	// Registries consulted for capability metadata. Models are provider-agnostic
	// (same weights on every lane), so native registries are valid references.
	const [registries, liveIds] = await Promise.all([
		Promise.all([
			loadRegistry("opencode-go", "openai-completions"),
			loadRegistry("zai", "openai-completions"),
			loadRegistry("anthropic", "anthropic-messages"),
			loadRegistry("kimi-coding", "anthropic-messages"),
			loadRegistry("google", "google-generative-ai"),
			loadRegistry("xai", "openai-responses"),
			loadRegistry("moonshotai", "openai-completions"),
			loadRegistry("nvidia", "openai-completions"),
			loadRegistry("minimax", "anthropic-messages"),
		]).then((rs) => rs.flat()),
		fetchOpencodeGoIds(),
	]);

	const ocgRegistry = registries[0];

	const ocgIds = liveIds ?? Object.keys(ocgRegistry);
	pi.registerProvider("opencode-go", {
		name: "exe opencode-go",
		baseUrl: `${BASE}/opencode-go/v1`,
		apiKey: KEYLESS,
		api: "openai-completions",
		models: ocgIds.map((id) => tagName(toConfig(retarget(ocgRegistry[id] ?? withDefaults(id), `${BASE}/opencode-go/v1`)), "oc-go")),
	});

	pi.registerProvider("command-code", {
		name: "exe command-code",
		baseUrl: `${BASE}/command-code/v1`,
		apiKey: KEYLESS,
		api: "openai-completions",
		models: COMMAND_CODE_IDS.map((id) =>
			tagName(toConfig(retarget(resolveModel(id, ...registries), `${BASE}/command-code/v1`)), "cmd"),
		),
	});

	pi.registerProvider("command-code-anthropic", {
		name: "exe command-code (anthropic)",
		baseUrl: `${BASE}/command-code`,
		apiKey: KEYLESS,
		api: "anthropic-messages",
		models: COMMAND_CODE_ANTHROPIC_IDS.map((id) =>
			tagName(toConfig(retarget(resolveModel(id, ...registries), `${BASE}/command-code`)), "cmd-claude"),
		),
	});

	pi.registerProvider("kimi-coding", {
		name: "exe kimi-coding",
		baseUrl: `${BASE}/kimi-code`,
		apiKey: KEYLESS,
		api: "anthropic-messages",
		models: KIMI_IDS.map((id) => tagName(toConfig(retarget(registries[3][id] ?? resolveModel(id, ...registries), `${BASE}/kimi-code`)), "kimi")),
	});
}
