import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  num_results: Type.Optional(
    Type.Number({
      description: "Number of results (1-10, default: 5)",
      default: 5,
    }),
  ),
  search_type: Type.Optional(
    StringEnum(["fast", "auto", "deep", "deep-reasoning"] as const),
  ),
  category: Type.Optional(
    StringEnum([
      "company",
      "news",
      "research paper",
      "tweet",
      "people",
    ] as const),
  ),
  max_age_hours: Type.Optional(
    Type.Number({
      description:
        "Maximum age of cached content in hours. 0=always livecrawl, -1=never livecrawl",
    }),
  ),
  include_domains: Type.Optional(
    Type.String({
      description: "Comma-separated list of domains to include",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.String({
      description: "Comma-separated list of domains to exclude",
    }),
  ),
});

type SearchParamsType = {
  query: string;
  num_results?: number;
  search_type?: "fast" | "auto" | "deep" | "deep-reasoning";
  category?: "company" | "news" | "research paper" | "tweet" | "people";
  max_age_hours?: number;
  include_domains?: string;
  exclude_domains?: string;
};

interface ExaResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  score: number;
}

interface ExaSearchResponse {
  results: ExaResult[];
  autocompletedQuery?: string;
}

interface SearchDetails {
  query: string;
  numResults: number;
  searchType: string;
  category?: string;
  resultCount: number;
  totalCharacters: number;
  truncated?: boolean;
  autocompletedQuery?: string;
}

const EXA_API_URL = "https://api.exa.ai/search";

function getApiKey(): string | undefined {
  return process.env.EXA_API_KEY;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "exa_search",
    label: "Exa Search",
    description:
      "Search the web using Exa AI. Returns relevant results with optional content highlights. Use for current information, research, and fact-checking.",
    parameters: SearchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error(
          "EXA_API_KEY environment variable not set. Get an API key at https://dashboard.exa.ai/api-keys",
        );
      }

      const {
        query,
        num_results = 5,
        search_type = "auto",
        category,
        max_age_hours,
        include_domains,
        exclude_domains,
      } = params as SearchParamsType;

      // Build request body
      const requestBody: Record<string, unknown> = {
        query,
        type: search_type,
        num_results: Math.min(Math.max(num_results, 1), 10),
        contents: {
          highlights: {
            max_characters: 4000,
          },
        },
      };

      if (category) {
        requestBody.category = category;
      }

      if (max_age_hours !== undefined) {
        requestBody.maxAgeHours = max_age_hours;
      }

      if (include_domains) {
        requestBody.includeDomains = include_domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
      }

      if (exclude_domains) {
        requestBody.excludeDomains = exclude_domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
      }

      const response = await fetch(EXA_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as ExaSearchResponse;

      if (!data.results || data.results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found for the query." }],
          details: {
            query,
            numResults: num_results,
            searchType: search_type,
            category,
            resultCount: 0,
            totalCharacters: 0,
          } as SearchDetails,
        };
      }

      // Format results
      let formattedOutput = "";
      if (data.autocompletedQuery && data.autocompletedQuery !== query) {
        formattedOutput += `Query auto-completed to: "${data.autocompletedQuery}"\n\n`;
      }

      let totalCharacters = 0;

      for (let i = 0; i < data.results.length; i++) {
        const result = data.results[i];
        if (!result) continue;

        formattedOutput += `[${i + 1}] ${result.title}\n`;
        formattedOutput += `URL: ${result.url}\n`;

        if (result.publishedDate) {
          formattedOutput += `Published: ${result.publishedDate}\n`;
        }

        if (result.author) {
          formattedOutput += `Author: ${result.author}\n`;
        }

        if (result.highlights && result.highlights.length > 0) {
          formattedOutput += `\nHighlights:\n`;
          for (const highlight of result.highlights) {
            formattedOutput += `  - ${highlight}\n`;
            totalCharacters += highlight.length;
          }
        }

        formattedOutput += `\n---\n\n`;
      }

      // Apply truncation
      const truncation = truncateHead(formattedOutput, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let resultText = truncation.content;
      const isTruncated = truncation.truncated;

      if (isTruncated) {
        resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
      }

      const details: SearchDetails = {
        query,
        numResults: num_results,
        searchType: search_type,
        category,
        resultCount: data.results.length,
        totalCharacters,
        truncated: isTruncated,
        autocompletedQuery: data.autocompletedQuery,
      };

      return {
        content: [{ type: "text", text: resultText }],
        details,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("exa_search "));
      text += theme.fg("accent", `"${args.query}"`);

      if (args.search_type && args.search_type !== "auto") {
        text += theme.fg("dim", ` type:${args.search_type}`);
      }

      if (args.category) {
        text += theme.fg("dim", ` category:${args.category}`);
      }

      if (args.num_results && args.num_results !== 5) {
        text += theme.fg("dim", ` n:${args.num_results}`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching Exa..."), 0, 0);
      }

      const details = result.details as SearchDetails | undefined;

      if (!details) {
        return new Text(theme.fg("dim", "Search completed"), 0, 0);
      }

      if (details.resultCount === 0) {
        return new Text(theme.fg("dim", "No results found"), 0, 0);
      }

      let text = theme.fg("success", `${details.resultCount} results`);

      if (details.autocompletedQuery) {
        text += theme.fg("muted", ` (auto-completed)`);
      }

      if (details.truncated) {
        text += theme.fg("warning", " [truncated]");
      }

      if (expanded && result.content[0]?.type === "text") {
        const content = result.content[0].text;
        const previewLines = content.split("\n").slice(0, 15);
        text += "\n" + theme.fg("dim", previewLines.join("\n"));

        if (content.split("\n").length > 15) {
          text += "\n" + theme.fg("muted", "...");
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // Register a command to check API key status
  pi.registerCommand("exa-status", {
    description: "Check Exa API key status",
    handler: async (_args, ctx) => {
      const apiKey = getApiKey();
      if (apiKey) {
        ctx.ui.notify(
          `Exa API key configured (${apiKey.slice(0, 8)}...)`,
          "info",
        );
      } else {
        ctx.ui.notify(
          "Exa API key not set. Set EXA_API_KEY environment variable.",
          "error",
        );
      }
    },
  });

  // Notify on startup if API key is missing
  pi.on("session_start", async (_event, ctx) => {
    if (!getApiKey()) {
      ctx.ui.notify(
        "Exa: API key not set. Set EXA_API_KEY to use exa_search.",
        "warning",
      );
    }
  });
}
