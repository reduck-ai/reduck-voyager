/**
 * The credentials a run hands the Reduck MCP, for both runners (run.ts, hermes.ts).
 *
 * An API key when REDUCK_API_KEY is set. Otherwise the Reduck CLI's OAuth token, which lives one
 * hour, and which the CLI refreshes only once it has expired: a token one minute from its end
 * would be handed to a run and die in it, its last calls failing as if Reduck had (seen
 * 2026-11-06). So a token that would not outlive the run is marked expired in the CLI's own
 * config first, and the CLI asked to refresh it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG = join(homedir(), ".config/reduck/config.json");

type Token = { access_token: string; expires_at?: number };
const token = (mcp: string): Token => JSON.parse(readFileSync(CONFIG, "utf8")).servers[mcp].tokens[mcp];

const whoami = () => execFileSync("npx", ["-y", "@reduck-ai/cli@latest", "whoami"], { stdio: "ignore" });

/** Headers for the Reduck MCP at `mcp`, good for at least `forMs`. */
export function reduckHeaders(mcp: string, forMs: number): Record<string, string> {
	if (process.env.REDUCK_API_KEY) return { "x-api-key": process.env.REDUCK_API_KEY };
	whoami();
	if ((token(mcp).expires_at ?? 0) < Date.now() + forMs) {
		const config = JSON.parse(readFileSync(CONFIG, "utf8"));
		config.servers[mcp].tokens[mcp].expires_at = 0;
		writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
		whoami();
		const fresh = token(mcp).expires_at ?? 0;
		if (fresh < Date.now() + forMs)
			throw new Error(`the Reduck CLI's token for ${mcp} would end before the run does: log in again`);
	}
	return { Authorization: `Bearer ${token(mcp).access_token}` };
}
