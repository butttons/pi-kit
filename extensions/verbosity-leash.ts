/**
 * Verbosity Leash Extension
 *
 * Appends conciseness instructions to the system prompt,
 * specifically targeting commit messages, PR descriptions,
 * changelogs, and documentation that the agent tends to
 * over-write.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CONCISENESS_PROMPT = `

## Writing Style for Artifacts

When writing commit messages, PR descriptions, changelogs, README sections, or documentation:

- Keep commit message headers under 72 characters. Body is 2-3 bullet points max.
- PR descriptions should be scannable. No walls of text. Use short bullet lists.
- Changelog entries are one sentence per change. No elaboration.
- README and docs sections should be tight. Cut filler words. If a sentence adds no information, remove it.
- Never use ornamental language in any of these. Plain, direct, factual.`;

export default function verbosityLeash(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: event.systemPrompt + CONCISENESS_PROMPT,
    };
  });
}
