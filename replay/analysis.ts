/**
 * The reading of the results that numbers alone do not give: what the transcripts show each tool
 * did. Written by whoever read the runs, after reading them; Analysis.svelte shows it under the
 * numbers it computes itself. A task with no note here shows its numbers alone.
 */
export type TaskNote = {
	/** What decided the task, in one or two sentences. */
	summary: string;
	/** The evidence: where the time, the tokens and the turns went, from the transcripts. */
	why?: string[];
};

export type Notes = {
	/** When these notes were last checked against the runs, YYYY-MM-DD. */
	asOf: string;
	/** What a reader with a minute takes away, first on the page. */
	tldr: string[];
	/** The few findings that hold across tasks. */
	findings: string[];
	/** What Reduck should change, each with the run that shows it. */
	fixes: string[];
	/** Per task, Reduck against Hermes' own browser on Hermes. */
	tasks: Record<string, TaskNote>;
};

export const NOTES: Notes = {
	asOf: "2026-11-09",
	tldr: [
		"Second trial on Hermes, against Hermes' own browser (Nov 9), after fixing the Reduck script that lost the last one on Amazon. On 3 tasks, Reduck passed all 3 with its own tool. Hermes' browser passed 2; on the invoices it fetched Cursor's PDF with curl, outside its tool, as on Nov 6.",
		"Where both passed, Reduck was 1.4\u00d7 faster on Amazon (0:57 against 1:19) and Trustpilot (1:50 against 2:37), and cost more on both ($0.23 against $0.16 and $0.14).",
		"Reduck's cost is the size of what its tools return, not its scripts' work: Amazon's filter list (45k characters, asked whole), Trustpilot's 1-star reviews (277k for 8 companies), its script list (22k). Hermes' browser prints only what it needs from the page.",
		"Hermes with Sonnet 5.5, Reduck at 2 scripts at once (4 in the Nov 6 trial), one run per task: a first read, not a verdict."
	],
	findings: [
		"Hermes' own browser is a second Chrome, which Hermes starts on a copy of the user's profile (so with the same sign-ins) and drives over the DevTools Protocol, with a window: headless, sites refuse it. Reduck acts from inside the user's own Chrome, through its extension.",
		"lib:amazon.com v37 (live) sends the delivery ZIP as soon as Amazon's token and session cookies are there, and skips it when the page already shows that ZIP: Reduck's Amazon run went from 1:34 to 0:57. Tested on the device and on 4 managed browsers with no cookies, the case an older version waited for.",
		"Reduck's agent spends its tokens on discovery and on large results: a tool search, the full script list (22k characters), contracts (8k to 12k each), then results it cannot print whole. Hermes saves a result over its limit to a file, and the agent parses it with Python in the terminal: the cost is reading it back.",
		"The agent chooses how much it reads. On Amazon it asked list_search_filters for its full output (45k characters against 24k clipped on Nov 6): 64k of context against 44k, $0.23 against $0.15, for the same answer.",
		"Each task keeps one run per tool. A run is discarded when the paired browser or its MCP stopped answering, a permission prompt timed out, a check could not run, or a person may have helped. Tool use is checked on every transcript."
	],
	fixes: [
		"Smaller results. trustpilot.com/get_reviews returns Trustpilot's page of 20 reviews with every field (about 35k characters a company), as the catalogue rules want; the MCP should return a compact form (or a field list) and keep the rest on request.",
		"Cheaper discovery. list_scripts with no argument returns about 22k characters and each contract 8k to 12k: return a short list by default.",
		"Notice when a site moves. Cursor's dashboard moved to grok.com and cursor.com/list_invoices failed until it was fixed (v11, Nov 6). Evals that run on a schedule would catch such a move before an agent does."
	],
	tasks: {
		"invoices-cursor-zapier": {
			summary:
				"Both downloaded the right two invoices. Reduck took 0:48 for $0.15, with its own scripts; Hermes' browser took 1:10 for $0.14 and, as on Nov 6, fetched Cursor's PDF with curl, outside its tool (marked \u26a0, left out of the comparison).",
			why: [
				"Reduck listed both sites' invoices in one call (cursor.com and zapier.com list_invoices), then downloaded both PDFs in another; Hermes saved the PDFs' base64 to a file and the agent decoded them in the terminal.",
				"Hermes' browser opened Cursor's invoice tab, read the Stripe PDF link from the row and ran curl on it. For Zapier, which has no download button, it printed the invoice page to PDF through the DevTools Protocol, inside its tool."
			]
		},
		"amazon-mac-stand": {
			summary:
				"Both listed the right 15 products with their ratings. Reduck was 1.4\u00d7 faster (0:57 against 1:19), Hermes' browser 1.4\u00d7 cheaper ($0.16 against $0.23).",
			why: [
				"The fix in lib:amazon.com v37 removed Reduck's 30 s wait before the search: 1:34 on Nov 6, 0:57 today.",
				"Reduck's cost went up ($0.15 to $0.23): this time the agent asked list_search_filters for its full output, 45k characters, and made two more discovery calls. Same 8 turns, same answer.",
				"Hermes' browser built the filtered results URL itself and read the 15 cards in page code."
			]
		},
		"trustpilot-vpns": {
			summary:
				"Both had the 8 TrustScores right. Reduck was 1.4\u00d7 faster (1:50 against 2:37), Hermes' browser 1.7\u00d7 cheaper ($0.14 against $0.23).",
			why: [
				"Reduck ran get_company and get_reviews for the 8 VPNs, two batches of 8. The reviews came back as 277k characters, which Hermes saved to a file and the agent parsed in the terminal.",
				"Hermes' browser went through the 8 companies' pages in Python loops, printing only the scores and the complaints."
			]
		},
	}
};
