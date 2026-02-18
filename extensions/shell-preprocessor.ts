/**
 * Shell Preprocessor - expands $`command` in prompts by running the command
 * and replacing it with the output before the agent sees it.
 *
 * Usage:
 *   What does this file do? $`cat src/index.ts`
 *   Fix the errors in $`bun test 2>&1 | tail -20`
 *   The current branch is $`git branch --show-current`
 *
 * Multiple expansions in one prompt work too:
 *   Compare $`cat old.ts` with $`cat new.ts`
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SHELL_PATTERN = /\$`([^`]+)`/g;

function hasShellExpansions({ text }: { text: string }): boolean {
	return /\$`([^`]+)`/.test(text);
}

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (!hasShellExpansions(event)) {
			return { action: "continue" };
		}

		const matches = [...event.text.matchAll(SHELL_PATTERN)];
		let result = event.text;

		for (const match of matches) {
			const command = match[1];
			const execResult = await pi.exec("bash", ["-c", command], {
				timeout: 30000,
			});

			const output = execResult.stdout.trim() || execResult.stderr.trim();
			const replacement =
				execResult.code === 0
					? output
					: `[command failed (exit ${execResult.code})]: ${output}`;

			result = result.replace(match[0], replacement);
		}

		return { action: "transform", text: result };
	});
}
