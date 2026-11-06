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
	/** The few findings that hold across tasks. */
	findings: string[];
	/** What Reduck should change, each with the run that shows it. */
	fixes: string[];
	tasks: Record<string, TaskNote>;
};

export const NOTES: Notes = {
	asOf: "2026-11-06",
	findings: [
		"Both tools passed all 5 tasks. On public sites with no sign-in, accuracy does not separate them: the difference is time, cost and context.",
		"Reduck was faster on 2 of 5 tasks (IMDb, Reddit) and cheaper on 1 (Reddit). Chrome was faster on Trustpilot, Zillow and the 3-store price check, and cheaper on 4 of 5.",
		"The Chrome arm rarely clicks. With a JavaScript tool in a real browser, the model writes its own scraper: it puts every filter in the URL, then reads the site's own data from inside the page (IMDb's GraphQL API, Trustpilot's and Zillow's embedded data). Where a site allows that, a capable model needs no saved script.",
		"Reduck's cost is overhead, not the scripts' work: about 40k characters of script lists and tool descriptions before the first run, script results of 40k to 140k characters, and a 96k-character guide each time a session opens. That is why it ends with more context on every task.",
		"Reduck's fan-out is limited by the paired browser: it runs 2 scripts at a time, so 12 product pages sent at once queue, and many tabs loading at once in a background window time out. Parallel runs pay off only within that budget.",
		"The model's way of working varies from run to run: the same IMDb task on the same Chrome arm took 1:42 in one trial and 5:01 in the next, where it waited on its own in-page scraper with 113 s of sleep. Every cell is one run: repeat the trials before drawing a ratio.",
		"Raising the paired browser's budget from 2 to 4 scripts at once did not settle anything: on Trustpilot, the only run that went end to end at 4, Reduck took 1:46 against 1:54 at 2, with the same cost and context. The 3 other runs at 4 lost the browser (pages timing out, then the extension no longer answering) and were set aside. The extension also dropped twice at a budget of 2 today, so the budget cannot be blamed on this evidence alone.",
		"Zillow's anti-bot protection flagged the browser after about 15 Zillow page loads in two hours, from Reduck's scripts, the checks and the Chrome arm together: one person's browser can only take so much of one site, whatever the tool. Zillow was left out of the trial at a budget of 4.",
		"Claude in Chrome refuses some sites outright: reddit.com was refused as \"not allowed due to safety restrictions\" when opened from this session. Reduck's scripts are not subject to that policy.",
		"Every run kept here went end to end, and the analysis states the Reduck budget (scripts at once) of each: runs where the paired browser stopped answering, a permission prompt timed out, or a check could not run were set aside and run again. Each kept run used its own tool alone (checked on every transcript)."
	],
	fixes: [
		"Smaller results, first. trustpilot.com/get_reviews returned 287 KB for 4 companies (replies and metadata included), imdb.com/search_titles 44k to 68k characters (plots, image links), the 3-store batch 139k. Offer a compact output or a fields argument: it is most of Reduck's extra context and cost.",
		"Cheaper discovery. list_scripts with no argument returns about 21k characters, read_script 8k to 18k, and start_session returns the whole authoring guide (96k characters) on every call. Return a short list by default and the guide once, on request.",
		"One script per page. Trustpilot's 1-star reviews page holds the TrustScore too, but it takes get_company and get_reviews: 16 page loads where Chrome needed 8.",
		"Faster scripts. Read the site's embedded data or its API from the page, as the Chrome arm does, instead of rendering and parsing the whole page: one Zillow search took 55 s, a Trustpilot page 12 to 20 s, where Chrome fetched 8 Trustpilot pages in about 1 s.",
		"Fan-out within the device's budget. A device runs 2 scripts at once by default (its owner can raise it): tell the agent its budget in run_script's description, or queue the rest without loading their tabs, so that 12 scripts sent at once do not time out in a background window.",
		"Consistent ids between scripts. The agent called walmart.com/get-product three times with itemId, the name it guessed from the search output: the id a search returns should be the argument the next script takes, under the same name.",
		"A reliable paired browser. The extension stopped answering twice in one afternoon (device_error, then lost its connection to reduck.ai), and needed Chrome to be restarted: it must recover on its own.",
		"Amazon limits review access on an account that reads many reviews pages (\"unusual activity\"): the review script now says so instead of returning unfiltered reviews, but the Amazon task cannot be run until the account's access is restored."
	],
	tasks: {
		"trustpilot-vpns": {
			summary:
				"Chrome won: 0:50 against 1:54, $0.14 against $0.26, 24k against 59k of context. Both had all 8 TrustScores right.",
			why: [
				"At a budget of 4 scripts at once instead of 2, Reduck took 1:46 instead of 1:54, at the same cost: the time goes to loading pages and parsing results, not to waiting for a free slot.",
				"Reduck spent 61% of its time waiting on scripts: 16 runs (get_company and get_reviews for each of the 8 companies), each a new tab loading Trustpilot, sent as 4 calls of 4, 12 to 20 s each.",
				"Chrome opened one Trustpilot page, then fetched the 8 companies' 1-star pages from inside it in one JavaScript call (about 1 s): each page carries both the TrustScore and the reviews in its embedded data.",
				"get_reviews returned 287 KB and 254 KB for 4 companies each: too large for the chat, so Hermes saved them to disk and the agent spent 3 more turns parsing them with Python.",
				"Quality is not settled: Reduck's complaints come from reading 20 recent 1-star reviews per company, Chrome's from keyword counts over the page text. The check grades the TrustScores only."
			]
		},
		"zillow-78704": {
			summary:
				"Both found the same 24 houses. Chrome was faster (1:13 against 3:18) and slightly cheaper ($0.17 against $0.20). Zillow's anti-bot protection stopped neither: both run in the user's own browser.",
			why: [
				"Chrome put every filter, the home type included, in the search URL, so the first page held exactly the 24 houses; it read them off the cards with JavaScript.",
				"Reduck's Zillow search script took 55 s for that one page, longer than the agent's wait, so it polled the result twice; then it opened 4 listings with a unit number (25 s) to be sure they were houses, not condos.",
				"The model sent two malformed calls (a tool call without its name); Hermes refused the first and the model retried."
			]
		},
		"headphones-3-stores": {
			summary:
				"Chrome won clearly: 2:51 against 6:47, $0.59 against $0.97, 69k against 161k of context. Both found the product on Amazon, Walmart and eBay.",
			why: [
				"Reduck sent 12 product pages as one batch to a browser that runs 2 at a time: they queued, and two timed out (\"no answer from the page in 60s: the browser is busy or the run window is asleep\").",
				"The agent called walmart.com/get-product three times with a wrong argument name (itemId), guessed from the search output.",
				"One batch returned 139k characters and the session it opened returned the 96k-character guide: both were saved to disk and parsed with 9 terminal calls, with 55 s of sleep while it polled.",
				"Chrome visited the three stores' search and product pages in turn and read them with JavaScript: 40 turns, but each a quick one."
			]
		},
		"imdb-deep-filter": {
			summary:
				"Reduck won on time: 1:40 against 5:01. Chrome was slightly cheaper ($0.27 against $0.30) with less context. Both found all 57 films.",
			why: [
				"Chrome built the search URL with every filter, then wrote an in-page scraper over IMDb's own data and waited for it with 113 s of sleep in the terminal. The same arm took 1:42 on this task in an earlier trial: the model's approach varies from run to run.",
				"Reduck ran one search script per language (8 to 19 s); its results were 44k and 68k characters, most of its 59k of context."
			]
		},
		"reddit-seo-post": {
			summary: "Reduck won: 1:11 against 1:32, $0.12 against $0.22, the same context. Both found the post.",
			why: [
				"Reduck ran 6 Google searches restricted to the subreddit with its Google script and read the post with its Reddit script: 8 turns. It also opened a browser session, which returned the 96k-character guide.",
				"Chrome went through Google result pages and the post itself: 21 turns."
			]
		}
	}
};
