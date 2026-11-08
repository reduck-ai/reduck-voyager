/**
 * Whether a run went through its own browser tool and nothing else. An arm is configured with one
 * browser tool (an MCP server, or Hermes' own browser toolset), but the agent keeps a shell (Claude Code's Bash, Hermes' terminal) and, under Claude
 * Code, WebFetch and WebSearch: a run can reach the site around its tool, and a comparison of the
 * two tools means nothing for that run. Read from the transcript, so it holds for every run
 * recorded, whatever runner made it.
 */
import type { Step } from "./session.ts";

export type Audit = {
	/** Calls to the arm's own browser tool. */
	own: number;
	/** Calls to another arm's browser tool. */
	other: number;
	/** Each call that reached the web another way: the tool and what it was given. */
	around: string[];
};

export type Arm = "reduck" | "chrome" | "browser";

const OWN: Record<Arm, RegExp> = {
	reduck: /^mcp__reduck__/,
	chrome: /^mcp__(chrome|claude-in-chrome)__/,
	browser: /^browser_(exec|cdp|dialog|vault)$/
};
/** Tools whose only use is the web. */
const WEB_TOOLS = /^(WebFetch|WebSearch|web_search|web_extract|browser_\w+)$/;
/** Tools that run code, which reach the web only when the code does. */
const CODE_TOOLS = /^(Bash|terminal|execute_code|code_execution)$/;
/** A request to a site in a command: an HTTP client called on it. A URL alone is no request:
 *  an agent prints the links of its answer, and results saved to disk and read back with jq or
 *  python are no request either. */
const REQUEST =
	/\b(curl|wget|httpie|aiohttp|httpx|requests\.(get|post|Session)|urllib|http\.client|fetch\(|urlopen|Invoke-WebRequest)/i;

export function audit(arm: Arm, steps: Step[]): Audit {
	const others = (Object.keys(OWN) as Arm[]).filter((a) => a !== arm).map((a) => OWN[a]);
	const result: Audit = { own: 0, other: 0, around: [] };
	for (const step of steps) {
		if (step.kind !== "tool") continue;
		if (OWN[arm].test(step.tool)) result.own++;
		else if (others.some((other) => other.test(step.tool))) result.other++;
		else {
			const input = JSON.stringify(step.input ?? "");
			if (WEB_TOOLS.test(step.tool) || (CODE_TOOLS.test(step.tool) && REQUEST.test(input)))
				result.around.push(`${step.tool}: ${input.slice(0, 160)}`);
		}
	}
	return result;
}

/** Why a run does not count as a test of its tool, or null when it does. */
export function offTool(arm: Arm, a: Audit): string | null {
	if (a.other) return `called another arm's tool ${a.other} times`;
	if (a.around.length) return `reached the web around its tool (${a.around[0].split(":")[0]})`;
	if (!a.own) return "never called its tool";
	return null;
}
