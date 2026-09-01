// exe.dev LLM gateway — keyless on exe VMs (https://llm.int.exe.xyz).
//
// Provider IDs match the local MacBook pi setup so paseo agent profiles
// (opencode-go/..., command-code/..., kimi-coding/...) work unchanged here.
//
// Metadata source of truth: pi's own model registry
// (@earendil-works/pi-ai/dist/providers/data/*.json) — the same data local
// pi uses, including compat flags (e.g. glm-5.3-flash has
// compat.supportsDeveloperRole: false; without it the upstream rejects the
// developer role with "[1214] Incorrect role information").
// Availability for opencode-go: live gateway model list, fetched once at
// startup; on failure the full registry list is used. No per-turn fetches.
// command-code is not in pi's registry, so its verified models are hardcoded.
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
	compat?: Record<string, unknown>;
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

async function fetchOpencodeGoIds(): Promise<string[] | null> {
	try {
		const res = await fetch(`${BASE}/opencode-go/v1/models`);
		const data = (await res.json()) as { data?: { id: string }[] };
		const ids = (data.data ?? []).map((m) => m.id.replace(/^opencode-go\//, ""));
		return ids.length > 0 ? ids : null;
	} catch {
		return null;
	}
}

function withDefaults(id: string): RegistryModel {
	return { id, name: id, reasoning: true, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 131072, maxTokens: 8192 };
}

// Display names carry the lane tag so opencode-go vs command-code is
// unambiguous in pickers (IDs must stay clean for profile portability).
function tagName(model: RegistryModel, tag: string): RegistryModel {
	const base = model.name && model.name !== model.id ? model.name : model.id;
	return { ...model, name: `${base} [${tag}]` };
}

function retarget(model: RegistryModel, baseUrl: string): RegistryModel {
	const { baseUrl: _drop, ...rest } = model;
	return { ...rest, baseUrl };
}

// Not in pi's registry. IDs differ from opencode-go for the same weights;
// verified via POST /command-code/v1/chat/completions on 2026-09-01.
const COMMAND_CODE_MODELS: RegistryModel[] = [
	{ id: "z-ai/glm-5.3-flash", reasoning: true, contextWindow: 1000000, maxTokens: 131072 },
	{ id: "xiaomi/mimo-v2.5", reasoning: true, contextWindow: 131072, maxTokens: 16384 },
	{ id: "deepseek/deepseek-v4-flash", reasoning: true, contextWindow: 1000000, maxTokens: 131072 },
].map((m) => ({ input: ["text"], cost: { input: 0, output: 0 }, ...m }));

const KIMI_IDS = ["kimi-for-coding", "k3", "k3-256k"]; // verified via /kimi-code/v1/messages

export default async function (pi: ExtensionAPI) {
	const [ocgRegistry, kimiRegistry, liveIds] = await Promise.all([
		loadRegistry("opencode-go", "openai-completions"),
		loadRegistry("kimi-coding", "anthropic-messages"),
		fetchOpencodeGoIds(),
	]);

	const ocgIds = liveIds ?? Object.keys(ocgRegistry);
	pi.registerProvider("opencode-go", {
		name: "exe opencode-go",
		baseUrl: `${BASE}/opencode-go/v1`,
		apiKey: KEYLESS,
		api: "openai-completions",
		models: ocgIds.map((id) => tagName(retarget(ocgRegistry[id] ?? withDefaults(id), `${BASE}/opencode-go/v1`), "oc-go")),
	});

	pi.registerProvider("command-code", {
		name: "exe command-code",
		baseUrl: `${BASE}/command-code/v1`,
		apiKey: KEYLESS,
		api: "openai-completions",
		models: COMMAND_CODE_MODELS.map((m) => tagName(retarget(m, `${BASE}/command-code/v1`), "cmd")),
	});

	const kimiModels = KIMI_IDS.map((id) => kimiRegistry[id] ?? withDefaults(id));
	pi.registerProvider("kimi-coding", {
		name: "exe kimi-coding",
		baseUrl: `${BASE}/kimi-code`,
		apiKey: KEYLESS,
		api: "anthropic-messages",
		models: kimiModels.map((m) => tagName(retarget(m, `${BASE}/kimi-code`), "kimi")),
	});
}
