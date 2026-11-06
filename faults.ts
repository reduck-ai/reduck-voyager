/**
 * Whether a run went end to end in the conditions the benchmark measures, read from its row and
 * its transcript. A run that did not (it ended early, its browser or the extension's connection
 * stopped answering, it waited on a permission prompt, it moved to Reduck's managed browsers,
 * or its check could not run)
 * measures the setup, not the tool: the runner keeps it under `runs/_faulty/` and the trial gets
 * none. A run that went end to end with a wrong answer is no fault: it is the result. Nor is a
 * script waiting in the device's queue behind the run's own scripts: a device runs a few at once
 * (its concurrency budget), and the batch runs one run at a time, so no other run is in it.
 */
import type { Step } from "./session.ts";

/** What a browser that stopped answering leaves in a tool's result, in any of its layers. */
const DEAD_BROWSER =
	/device_error|did not answer|extension is not connected|browser has been closed|Target page, context or browser has been closed|wake device: could not reach|fetch failed \(ETIMEDOUT\)/i;
/** A Claude in Chrome action that waited on its permission window until it timed out: the time
 *  is a person's, not the tool's. */
const PERMISSION_WAIT = /permission prompt before it timed out/i;

export function fault(
	row: { arm: string; outcome: string; verdict: { detail?: string } | null },
	steps: Step[]
): string | null {
	if (row.outcome !== "success") return `the run ended with: ${row.outcome}`;
	if (row.verdict?.detail?.startsWith("check crashed")) return "its check could not run";
	for (const step of steps) {
		if (step.kind !== "tool") continue;
		if (DEAD_BROWSER.test(step.result ?? "")) return `the browser stopped answering (${step.tool})`;
		if (PERMISSION_WAIT.test(step.result ?? "")) return "it waited on a browser permission prompt";
		if (row.arm === "reduck" && /"browser":\s*"managed"/.test(JSON.stringify(step.input ?? "")))
			return "it moved to Reduck's managed browsers";
	}
	return null;
}
