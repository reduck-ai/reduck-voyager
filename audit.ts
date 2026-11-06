/**
 * Whether a run went through its own browser tool and nothing else. An arm is configured with one
 * MCP server, but the agent keeps a shell (Claude Code's Bash, Hermes' terminal) and, under Claude
 * Code, WebFetch and WebSearch: a run can reach the site around its tool, and a comparison of the
 * two tools means nothing for that run. Read from the transcript, so it holds for every run
 * recorded, whatever runner made it.
 */
import type { Step } from "./session.ts";

export type Audit = {
	/** Calls to the arm's own MCP server. */
	own: number;
	/** Calls to the other arm's MCP server. */
	other: number;
	/** Each call that reached the web another way: the tool and what it was given. */
	around: string[];
};

const MCP: Record<"reduck" | "chrome", RegExp> = {
	reduck: /^mcp__reduck__/,
	chrome: /^mcp__(chrome|claude-in-chrome)__/
};
/** Tools whose only use is the web. */
const WEB_TOOLS = /^(WebFetch|WebSearch|web_search|web_extract|browser_\w+)$/;
/** Tools that run code, which reach the web only when the code does. */
const CODE_TOOLS = /^(Bash|terminal|execute_code|code_execution)$/;
/** A request to a site in a command: a client, or a URL that is not this machine. Results
 *  saved to disk and read back with jq or python are no request. */
const REQUEST =
	/\b(curl|wget|httpie|requests\.(get|post)|urllib|http\.client|fetch\()|https?:\/\/(?!(localhost|127\.0\.0\.1)[:/])/i;

export function audit(arm: "reduck" | "chrome", steps: Step[]): Audit {
	const other = arm === "reduck" ? MCP.chrome : MCP.reduck;
	const result: Audit = { own: 0, other: 0, around: [] };
	for (const step of steps) {
		if (step.kind !== "tool") continue;
		if (MCP[arm].test(step.tool)) result.own++;
		else if (other.test(step.tool)) result.other++;
		else {
			const input = JSON.stringify(step.input ?? "");
			if (WEB_TOOLS.test(step.tool) || (CODE_TOOLS.test(step.tool) && REQUEST.test(input)))
				result.around.push(`${step.tool}: ${input.slice(0, 160)}`);
		}
	}
	return result;
}

/** Why a run does not count as a test of its tool, or null when it does. */
export function offTool(arm: "reduck" | "chrome", a: Audit): string | null {
	if (a.other) return `called the other tool ${a.other} times`;
	if (a.around.length) return `reached the web around its tool (${a.around[0].split(":")[0]})`;
	if (!a.own) return "never called its tool";
	return null;
}
