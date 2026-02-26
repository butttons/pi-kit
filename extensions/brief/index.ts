/**
 * Brief Extension
 *
 * Generate structured activity briefs from GitHub and pi session data.
 * Fully self-contained: gathers data, calls the LLM to synthesize,
 * writes the file, and shows progress in the TUI.
 *
 * Usage:
 *   /brief daily                  -- today
 *   /brief daily 2026-02-25       -- specific date
 *   /brief weekly                 -- current ISO week
 *   /brief weekly 2026-W09        -- specific week
 *   /brief monthly                -- current month
 *   /brief monthly 2026-02        -- specific month
 *
 * Flag:
 *   --brief-output <path>         -- override output directory
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { gatherBriefData, formatBriefData } from "./gatherers.js";
import type { DateRange } from "./gatherers.js";

const DEFAULT_OUTPUT = join(
  process.env.HOME ?? "~",
  "Library",
  "Mobile Documents",
  "iCloud~md~obsidian",
  "Documents",
  "Brief",
);

const SYSTEM_PROMPT = `You are a personal activity reporter. You receive structured data about GitHub commits, pull requests, and coding session transcripts for a time period.

Your job is to synthesize this into a tight, scannable brief. Not a report -- a brief. Compress aggressively. The reader has full access to the raw data; the brief exists to give a quick picture of the day/week/month, not to catalogue everything.

Word budget for the prose sections (Summary + Git Activity + Open Threads combined, excluding the table, timeline, and frontmatter):
- Daily: around 200-300 words. Flex if the day was unusually busy.
- Weekly: around 400-600 words.
- Monthly: max ~1000 words.
These are guidelines, not hard limits. Use judgment.

Structure (use only these sections):
1. Frontmatter
2. Heading + at-a-glance table
3. Summary -- a few sentences. Status update to yourself about the overall period.
4. Projects -- one bold project name followed by a single sentence. More context than the table, less than a full description. One line per project.
5. Timeline -- chronological activity blocks (Obsidian timeline-labeled code block). Each entry includes relevant commit links in the content.
6. Open Threads -- only if there is clear evidence of unfinished work.

Do NOT include separate "Sessions" or "Git Activity" sections. Session counts go in the frontmatter.

Rules:
- Every item must trace to a commit, PR, or session message. Do not fabricate anything.
- Skip sections with no data entirely.
- No emojis anywhere.
- Keep project names short (e.g. "obi" not "butttons/obi" unless disambiguation is needed).
- The table is one row per active project. Summary column is a single short sentence.
- For daily briefs, the table has a Time column: estimated hours + percentage of the working day. Percentages add up to 100%. Format: "2h (25%)".
- For weekly/monthly briefs, the table has a Date column showing the date of activity.
- Timeline entries are chronological. Daily uses "HH:MM" from timestamps. Weekly/monthly uses human-readable dates like "Monday, 1 Jan, 2025". Each entry is one meaningful activity block, not every commit. Content is one sentence describing what happened, followed by a "Commits:" line with the relevant markdown commit links (e.g. [\`abc1234\`](url)). Omit the Commits line if there are no commits for that block.`;

// -- Date utilities --

function getISOWeek({ date }: { date: Date }): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getISOWeekYear({ date }: { date: Date }): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function pad({ n }: { n: number }): string {
  return n.toString().padStart(2, "0");
}

function toDateStr({ date }: { date: Date }): string {
  return `${date.getFullYear()}-${pad({ n: date.getMonth() + 1 })}-${pad({ n: date.getDate() })}`;
}

function getMondayOfWeek({ year, week }: { year: number; week: number }): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

function parsePeriodAndDate({ args }: { args: string }): {
  period: "daily" | "weekly" | "monthly";
  range: DateRange;
  filename: string;
} | null {
  const parts = args.trim().split(/\s+/);
  const period = parts[0] as "daily" | "weekly" | "monthly";
  const dateArg = parts[1];

  if (!["daily", "weekly", "monthly"].includes(period)) {
    return null;
  }

  const now = new Date();

  if (period === "daily") {
    const dateStr = dateArg ?? toDateStr({ date: now });
    return {
      period,
      range: { start: dateStr, end: dateStr },
      filename: `daily/${dateStr}.md`,
    };
  }

  if (period === "weekly") {
    let year: number;
    let week: number;

    if (dateArg && /^\d{4}-W\d{2}$/.test(dateArg)) {
      year = parseInt(dateArg.slice(0, 4), 10);
      week = parseInt(dateArg.slice(6), 10);
    } else {
      year = getISOWeekYear({ date: now });
      week = getISOWeek({ date: now });
    }

    const monday = getMondayOfWeek({ year, week });
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    return {
      period,
      range: {
        start: toDateStr({ date: monday }),
        end: toDateStr({ date: sunday }),
      },
      filename: `weekly/${year}-W${pad({ n: week })}.md`,
    };
  }

  // monthly
  let year: number;
  let month: number;

  if (dateArg && /^\d{4}-\d{2}$/.test(dateArg)) {
    year = parseInt(dateArg.slice(0, 4), 10);
    month = parseInt(dateArg.slice(5), 10);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const lastDay = new Date(year, month, 0).getDate();

  return {
    period,
    range: {
      start: `${year}-${pad({ n: month })}-01`,
      end: `${year}-${pad({ n: month })}-${pad({ n: lastDay })}`,
    },
    filename: `monthly/${year}-${pad({ n: month })}.md`,
  };
}

function buildUserPrompt({
  period,
  range,
  formatted,
}: {
  period: "daily" | "weekly" | "monthly";
  range: DateRange;
  formatted: string;
}): string {
  const dateLabel =
    period === "daily" ? range.start : `${range.start} to ${range.end}`;

  const frontmatterDate =
    period === "daily"
      ? `date: ${range.start}`
      : `start: ${range.start}\nend: ${range.end}`;

  return [
    `Generate a ${period} brief from the gathered data below.`,
    "",
    "Use this exact structure:",
    "",
    "```",
    "---",
    `type: ${period}`,
    frontmatterDate,
    "projects: [list, of, active, projects]",
    "sessions: <count>",
    "commits: <count>",
    "---",
    "",
    `# Brief -- ${dateLabel}`,
    "",
    ...(period === "daily"
      ? [
          "| Project | Time | Summary |",
          "| ------- | ---- | ------- |",
          "| project-name | Nh (XX%) | one-line summary of activity |",
          "(one row per active project; Time = estimated hours spent + percentage of total day; percentages must add up to 100%)",
        ]
      : [
          "| Date | Project | Summary |",
          "| ---- | ------- | ------- |",
          "| YYYY-MM-DD | project-name | one-line summary of activity |",
          "(one row per active project, derived from commits + sessions)",
        ]),
    "",
    "## Summary",
    "",
    "## Projects",
    "",
    "**project-name**: one sentence about what happened and where it stands now.",
    "(one entry per active project, slightly more detail than the table)",
    "",
    "## Timeline",
    "",
    "```timeline-labeled",
    "[line-3, body-2]",
    ...(period === "daily"
      ? [
          "date: HH:MM",
          "title: project-name",
          "content:",
          "What happened at this time.",
          "Commits: [`abc1234`](url), [`def5678`](url)",
        ]
      : (() => {
          const exampleDate = new Date(range.start + "T00:00:00");
          const formatted = exampleDate.toLocaleDateString("en-US", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          return [
            `date: ${formatted}`,
            "title: project-name",
            "content:",
            "What happened on this date.",
            "Commits: [`abc1234`](url), [`def5678`](url)",
          ];
        })()),
    "```",
    "(chronological entries derived from commit timestamps and session message timestamps)",
    "",
    "## Open Threads",
    "```",
    "",
    "Output ONLY the markdown content. No preamble, no code fences wrapping the output.",
    "",
    "---",
    "",
    formatted,
  ].join("\n");
}

// -- Extension entry point --

export default function brief(pi: ExtensionAPI): void {
  pi.registerFlag("brief-output", {
    description: "Output directory for briefs (Obsidian vault path)",
    type: "string",
    default: DEFAULT_OUTPUT,
  });

  pi.registerCommand("brief", {
    description:
      "Generate activity brief: /brief <daily|weekly|monthly> [date]",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify(
          "Usage: /brief <daily|weekly|monthly> [YYYY-MM-DD|YYYY-WNN|YYYY-MM]",
          "error",
        );
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const parsed = parsePeriodAndDate({ args });
      if (!parsed) {
        ctx.ui.notify(
          "Invalid period. Use: daily, weekly, or monthly",
          "error",
        );
        return;
      }

      const outputPath =
        (pi.getFlag("--brief-output") as string) ?? DEFAULT_OUTPUT;
      const outputFile = join(outputPath, parsed.filename);

      // Check if brief already exists
      if (existsSync(outputFile)) {
        if (!ctx.hasUI) {
          console.error(`Brief already exists: ${outputFile}`);
          console.error("Delete it first or use the interactive TUI to overwrite.");
          return;
        }
        const isOverwrite = await ctx.ui.confirm(
          "Brief exists",
          `${outputFile} already exists. Overwrite?`,
        );
        if (!isOverwrite) return;
      }

      const exec = async (
        cmd: string,
        execArgs: string[],
        opts?: { timeout?: number },
      ) => {
        const r = await pi.exec(cmd, execArgs, opts);
        return {
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
          code: r.code ?? 1,
        };
      };

      const generateBrief = async ({ signal }: { signal?: AbortSignal }) => {
        const data = await gatherBriefData({
          period: parsed.period,
          range: parsed.range,
          outputPath,
          exec,
        });

        const formatted = formatBriefData({ data });
        const userPrompt = buildUserPrompt({
          period: parsed.period,
          range: parsed.range,
          formatted,
        });

        const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);

        const userMessage: Message = {
          role: "user",
          content: [{ type: "text", text: userPrompt }],
          timestamp: Date.now(),
        };

        const response = await complete(
          ctx.model!,
          { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
          { apiKey, signal },
        );

        if (response.stopReason === "aborted") {
          return null;
        }

        const briefContent = response.content
          .filter(
            (c): c is { type: "text"; text: string } => c.type === "text",
          )
          .map((c) => c.text)
          .join("\n");

        const outputDir = dirname(outputFile);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        writeFileSync(outputFile, briefContent, "utf8");
        return briefContent;
      };

      if (!ctx.hasUI) {
        // Non-interactive mode (pi -p)
        try {
          console.log(`Generating ${parsed.period} brief...`);
          const content = await generateBrief({});
          if (content) {
            console.log(`Brief written to ${outputFile}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Brief failed: ${message}`);
        }
        return;
      }

      type BriefResult =
        | { status: "ok"; content: string }
        | { status: "cancelled" }
        | { status: "error"; message: string };

      // Run inside a TUI loader
      const result = await ctx.ui.custom<BriefResult>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            "Generating brief...",
          );
          loader.onAbort = () => done({ status: "cancelled" });

          generateBrief({ signal: loader.signal })
            .then((content) => {
              if (content === null) {
                done({ status: "cancelled" });
              } else {
                done({ status: "ok", content });
              }
            })
            .catch((err) => {
              done({ status: "error", message: err?.message ?? String(err) });
            });

          return loader;
        },
      );

      if (result.status === "cancelled") {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      if (result.status === "error") {
        ctx.ui.notify(`Brief failed: ${result.message}`, "error");
        return;
      }

      ctx.ui.notify(`Brief written to ${outputFile}`, "info");
    },
  });
}
