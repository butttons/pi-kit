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
function toConfig(m: RegistryModel): ProviderModelConfig {
	return {
		...m,
		name: m.name ?? m.id,
		reasoning: m.reasoning ?? true,
		input: m.input ?? ["text"],
		cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0, cacheRead: m.cost?.cacheRead ?? 0, cacheWrite: m.cost?.cacheWrite ?? 0 },
		contextWindow: m.contextWindow ?? 131072,
		maxTokens: m.maxTokens ?? 8192,
	};
}

function stripPrefix(id: string): string {
	return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

// Capability lookup candidates: exact id, prefix-stripped, then the base
// model family (e.g. "glm-5.3-flash" -> "glm-5.3", "glm-5.2-fast" ->
// "glm-5.2-highspeed"). Variant suffixes served by command-code often
// aren't in pi's registry but share the base model's capabilities.
function resolveCandidates(id: string): string[] {
	const bare = stripPrefix(id);
	const candidates = [id, bare];
	const base = bare.match(/^(glm-[\d.]+)-/);
	if (base) candidates.push(base[1], base[1] + "-highspeed");
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
	const [ocgRegistry, zaiRegistry, anthropicRegistry, kimiRegistry, liveIds] = await Promise.all([
		loadRegistry("opencode-go", "openai-completions"),
		loadRegistry("zai", "openai-completions"),
		loadRegistry("anthropic", "anthropic-messages"),
		loadRegistry("kimi-coding", "anthropic-messages"),
		fetchOpencodeGoIds(),
	]);

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
			tagName(toConfig(retarget(resolveModel(id, ocgRegistry, zaiRegistry), `${BASE}/command-code/v1`)), "cmd"),
		),
	});

	pi.registerProvider("command-code-anthropic", {
		name: "exe command-code (anthropic)",
		baseUrl: `${BASE}/command-code`,
		apiKey: KEYLESS,
		api: "anthropic-messages",
		models: COMMAND_CODE_ANTHROPIC_IDS.map((id) =>
			tagName(toConfig(retarget(resolveModel(id, anthropicRegistry), `${BASE}/command-code`)), "cmd-claude"),
		),
	});

	pi.registerProvider("kimi-coding", {
		name: "exe kimi-coding",
		baseUrl: `${BASE}/kimi-code`,
		apiKey: KEYLESS,
		api: "anthropic-messages",
		models: KIMI_IDS.map((id) => tagName(toConfig(retarget(kimiRegistry[id] ?? withDefaults(id), `${BASE}/kimi-code`)), "kimi")),
	});
}
