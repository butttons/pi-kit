/**
 * Data gatherers for the brief extension.
 *
 * Two sources:
 * 1. GitHub activity (commits, PRs) via `gh` CLI
 * 2. Pi session transcripts from ~/.pi/agent/sessions/
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const SESSIONS_ROOT = join(process.env.HOME ?? "~", ".pi", "agent", "sessions");
const GH_OWNERS = ["butttons", "zomunk"] as const;

// -- Types --

type DateRange = {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
};

type Commit = {
  repo: string;
  sha: string;
  message: string;
  date: string;
  author: string;
};

type PullRequest = {
  repo: string;
  title: string;
  state: string;
  createdAt: string;
  url: string;
};

type GitHubData = {
  commits: Commit[];
  prsAuthored: PullRequest[];
  prsReviewed: PullRequest[];
};

type SessionData = {
  project: string;
  file: string;
  date: string;
  startTime: string;
  userMessages: string[];
  compactionSummaries: string[];
  filesTouched: string[];
  messageCount: number;
};

type BriefData = {
  period: "daily" | "weekly" | "monthly";
  range: DateRange;
  github: GitHubData;
  sessions: SessionData[];
  existingDailies: string[];
};

// -- GitHub gatherer --

async function fetchActiveRepos({
  range,
  exec,
}: {
  range: DateRange;
  exec: ExecFn;
}): Promise<string[]> {
  const repos: string[] = [];

  // Personal repos via viewer
  const viewerResult = await exec("bash", [
    "-c",
    `gh api graphql -f query='{ viewer { repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { nameWithOwner, pushedAt } } } }' --jq '.data.viewer.repositories.nodes[] | select(.pushedAt >= "${range.start}") | .nameWithOwner'`,
  ], { timeout: 15000 });

  if (viewerResult.code === 0 && viewerResult.stdout.trim()) {
    repos.push(...viewerResult.stdout.trim().split("\n"));
  }

  // Org repos
  for (const owner of GH_OWNERS) {
    if (owner === "butttons") continue; // Already covered by viewer
    const orgResult = await exec("bash", [
      "-c",
      `gh api graphql -f query='{ organization(login: "${owner}") { repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { nameWithOwner, pushedAt } } } }' --jq '.data.organization.repositories.nodes[] | select(.pushedAt >= "${range.start}") | .nameWithOwner'`,
    ], { timeout: 15000 });

    if (orgResult.code === 0 && orgResult.stdout.trim()) {
      repos.push(...orgResult.stdout.trim().split("\n"));
    }
  }

  return repos;
}

async function fetchCommits({
  repos,
  range,
  exec,
}: {
  repos: string[];
  range: DateRange;
  exec: ExecFn;
}): Promise<Commit[]> {
  const commits: Commit[] = [];

  for (const repo of repos) {
    const result = await exec("bash", [
      "-c",
      `gh api "repos/${repo}/commits?since=${range.start}T00:00:00Z&until=${range.end}T23:59:59Z&per_page=100" --jq '.[] | {sha: .sha[:7], message: .commit.message | split("\\n")[0], date: .commit.author.date, author: .commit.author.name}'`,
    ], { timeout: 15000 });

    if (result.code === 0 && result.stdout.trim()) {
      for (const line of result.stdout.trim().split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(line) as {
            sha: string;
            message: string;
            date: string;
            author: string;
          };
          commits.push({
            repo,
            ...parsed,
            date: new Date(parsed.date).toLocaleString(),
          });
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  return commits;
}

async function fetchPRs({
  range,
  exec,
}: {
  range: DateRange;
  exec: ExecFn;
}): Promise<{ authored: PullRequest[]; reviewed: PullRequest[] }> {
  const authored: PullRequest[] = [];
  const reviewed: PullRequest[] = [];

  // PRs authored
  const authoredResult = await exec("bash", [
    "-c",
    `gh search prs --author=butttons --created=${range.start}..${range.end} --json repository,title,state,createdAt,url --limit 100`,
  ], { timeout: 15000 });

  if (authoredResult.code === 0 && authoredResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(authoredResult.stdout) as Array<{
        repository: { nameWithOwner: string };
        title: string;
        state: string;
        createdAt: string;
        url: string;
      }>;
      for (const pr of parsed) {
        authored.push({
          repo: pr.repository.nameWithOwner,
          title: pr.title,
          state: pr.state,
          createdAt: pr.createdAt,
          url: pr.url,
        });
      }
    } catch {
      // skip
    }
  }

  // PRs reviewed
  const reviewedResult = await exec("bash", [
    "-c",
    `gh search prs --reviewed-by=butttons --created=${range.start}..${range.end} --json repository,title,state,createdAt,url --limit 100`,
  ], { timeout: 15000 });

  if (reviewedResult.code === 0 && reviewedResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(reviewedResult.stdout) as Array<{
        repository: { nameWithOwner: string };
        title: string;
        state: string;
        createdAt: string;
        url: string;
      }>;
      for (const pr of parsed) {
        reviewed.push({
          repo: pr.repository.nameWithOwner,
          title: pr.title,
          state: pr.state,
          createdAt: pr.createdAt,
          url: pr.url,
        });
      }
    } catch {
      // skip
    }
  }

  return { authored, reviewed };
}

async function gatherGitHub({
  range,
  exec,
}: {
  range: DateRange;
  exec: ExecFn;
}): Promise<GitHubData> {
  const repos = await fetchActiveRepos({ range, exec });
  const commits = await fetchCommits({ repos, range, exec });
  const { authored, reviewed } = await fetchPRs({ range, exec });

  return {
    commits,
    prsAuthored: authored,
    prsReviewed: reviewed,
  };
}

// -- Session gatherer --

function extractProjectName({ dirName }: { dirName: string }): string {
  // Session dirs look like: --Users-yash-Work-pi-kit--
  // Strip outer dashes, split on /, take meaningful segments
  const stripped = dirName.replace(/^-+|-+$/g, "");
  const parts = stripped.replace(/--/g, "/").split("/");

  // Find the segment after "Work" or use last meaningful segment
  const workIdx = parts.findIndex(
    (p) => p === "Work" || p === "work",
  );
  if (workIdx !== -1 && workIdx < parts.length - 1) {
    return parts.slice(workIdx + 1).join("/");
  }

  // Fallback: last 2 segments or the whole thing
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return stripped;
}

function extractUserMessageText({
  content,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw JSONL content with unknown shape
  content: any;
}): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((b: Record<string, string>) => b.type === "text")
    .map((b: Record<string, string>) => b.text)
    .join("\n");
}

function isSkillInjection({ text }: { text: string }): boolean {
  return text.trimStart().startsWith("<skill ");
}

function gatherSessions({ range }: { range: DateRange }): SessionData[] {
  const sessions: SessionData[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(SESSIONS_ROOT);
  } catch {
    return [];
  }

  for (const dir of projectDirs) {
    const dirPath = join(SESSIONS_ROOT, dir);
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      // Timestamp prefix: 2026-02-26T11-12-52-404Z_uuid.jsonl
      const dateStr = file.slice(0, 10);
      if (dateStr < range.start || dateStr > range.end) continue;

      const filePath = join(dirPath, file);
      const project = extractProjectName({ dirName: dir });

      // Parse UTC timestamp from filename: 2026-02-26T11-12-52-404Z_uuid.jsonl
      // Convert dashes back to colons for the time part, drop the ms+uuid suffix
      const tsRaw = file.slice(0, 23); // 2026-02-26T11-12-52-404
      const tsIso = tsRaw.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}).*/, "$1T$2:$3:$4Z");
      const startTime = new Date(tsIso).toLocaleString();

      const userMessages: string[] = [];
      const compactionSummaries: string[] = [];
      const filesTouched = new Set<string>();
      let messageCount = 0;

      try {
        const content = readFileSync(filePath, "utf8");
        for (const line of content.trim().split("\n")) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsing raw JSONL with unknown shapes
          let entry: Record<string, any>;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }

          if (entry.type === "compaction" && entry.summary) {
            compactionSummaries.push(entry.summary.slice(0, 500));
            continue;
          }

          if (entry.type !== "message") continue;

          const msg = entry.message;
          if (!msg) continue;

          if (msg.role === "user") {
            messageCount++;
            const text = extractUserMessageText({ content: msg.content });
            if (text.trim() && !isSkillInjection({ text })) {
              userMessages.push(text.slice(0, 300));
            }
            continue;
          }

          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (
                block.type === "toolCall" &&
                (block.name === "write" || block.name === "edit") &&
                block.arguments?.path
              ) {
                filesTouched.add(block.arguments.path);
              }
            }
          }
        }
      } catch {
        continue;
      }

      if (messageCount === 0 && compactionSummaries.length === 0) continue;

      sessions.push({
        project,
        file,
        date: dateStr,
        startTime,
        userMessages: userMessages.slice(0, 30),
        compactionSummaries,
        filesTouched: [...filesTouched].slice(0, 30),
        messageCount,
      });
    }
  }

  return sessions;
}

// -- Existing dailies reader --

function readExistingDailies({
  outputPath,
  range,
}: {
  outputPath: string;
  range: DateRange;
}): string[] {
  const dailyDir = join(outputPath, "daily");
  const dailies: string[] = [];

  let files: string[];
  try {
    files = readdirSync(dailyDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }

  for (const file of files) {
    const dateStr = basename(file, ".md"); // YYYY-MM-DD
    if (dateStr < range.start || dateStr > range.end) continue;

    try {
      const content = readFileSync(join(dailyDir, file), "utf8");
      dailies.push(content);
    } catch {
      continue;
    }
  }

  return dailies;
}

// -- Public API --

type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

export type { BriefData, DateRange, Commit, PullRequest, SessionData, GitHubData };

export function formatBriefData({ data }: { data: BriefData }): string {
  const lines: string[] = [];

  lines.push(`Period: ${data.period}`);
  lines.push(`Range: ${data.range.start} to ${data.range.end}`);
  lines.push("");

  // GitHub
  lines.push("## GitHub Activity");
  lines.push("");

  if (data.github.commits.length > 0) {
    lines.push(`### Commits (${data.github.commits.length})`);
    const byRepo = new Map<string, typeof data.github.commits>();
    for (const c of data.github.commits) {
      const list = byRepo.get(c.repo) ?? [];
      list.push(c);
      byRepo.set(c.repo, list);
    }
    for (const [repo, commits] of byRepo) {
      lines.push(`\n**${repo}** (${commits.length}):`);
      for (const c of commits) {
        lines.push(`- [\`${c.sha}\`](https://github.com/${repo}/commit/${c.sha}) ${c.message} (${c.date})`);
      }
    }
    lines.push("");
  } else {
    lines.push("No commits in this period.");
    lines.push("");
  }

  if (data.github.prsAuthored.length > 0) {
    lines.push(`### PRs Authored (${data.github.prsAuthored.length})`);
    for (const pr of data.github.prsAuthored) {
      lines.push(`- [${pr.state}] **${pr.repo}**: ${pr.title} (${pr.url})`);
    }
    lines.push("");
  }

  if (data.github.prsReviewed.length > 0) {
    lines.push(`### PRs Reviewed (${data.github.prsReviewed.length})`);
    for (const pr of data.github.prsReviewed) {
      lines.push(`- [${pr.state}] **${pr.repo}**: ${pr.title} (${pr.url})`);
    }
    lines.push("");
  }

  // Sessions
  lines.push(`## Pi Sessions (${data.sessions.length})`);
  lines.push("");

  if (data.sessions.length > 0) {
    const byProject = new Map<string, typeof data.sessions>();
    for (const s of data.sessions) {
      const list = byProject.get(s.project) ?? [];
      list.push(s);
      byProject.set(s.project, list);
    }

    for (const [project, sessions] of byProject) {
      const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
      lines.push(`### ${project} (${sessions.length} sessions, ${totalMessages} messages)`);
      for (const s of sessions) {
        lines.push(`\n**${s.file}** (started ${s.startTime}, ${s.messageCount} messages, ${s.filesTouched.length} files touched):`);

        if (s.compactionSummaries.length > 0) {
          lines.push("Compaction summaries:");
          for (const summary of s.compactionSummaries) {
            lines.push(`> ${summary}`);
          }
        }

        if (s.userMessages.length > 0) {
          lines.push("User messages:");
          for (const msg of s.userMessages) {
            lines.push(`> ${msg}`);
          }
        }

        if (s.filesTouched.length > 0) {
          lines.push(`Files: ${s.filesTouched.join(", ")}`);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("No pi sessions in this period.");
    lines.push("");
  }

  // Existing dailies (for weekly/monthly)
  if (data.existingDailies.length > 0) {
    lines.push(`## Existing Daily Briefs (${data.existingDailies.length})`);
    lines.push("");
    lines.push("Cross-reference these for nuance the raw data may miss:");
    lines.push("");
    for (const daily of data.existingDailies) {
      lines.push("---");
      lines.push(daily);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function gatherBriefData({
  period,
  range,
  outputPath,
  exec,
}: {
  period: "daily" | "weekly" | "monthly";
  range: DateRange;
  outputPath: string;
  exec: ExecFn;
}): Promise<BriefData> {
  const github = await gatherGitHub({ range, exec });
  const sessions = gatherSessions({ range });

  // For weekly/monthly, also pull in existing dailies
  const existingDailies =
    period !== "daily"
      ? readExistingDailies({ outputPath, range })
      : [];

  return {
    period,
    range,
    github,
    sessions,
    existingDailies,
  };
}
