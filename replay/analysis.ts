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
	asOf: "2026-11-08",
	tldr: [
		"On Hermes, against Hermes' own browser in one trial, Reduck passed all 5 tasks: Reddit, Trustpilot, IMDb, an Amazon search with 4 filters, and two invoices from two signed-in billing pages. Hermes' browser passed 4, one of them by fetching a PDF outside its tool.",
		"Where both passed with their own tool, neither won outright. Reduck was faster on Trustpilot (1.8\u00d7) and cheaper on Reddit (1.7\u00d7); Hermes' browser was faster and cheaper on Amazon (1.8\u00d7 faster, 1.6\u00d7 cheaper), where 30 s of Reduck's 94 s was its Amazon script waiting for a page that never finishes loading. On the invoices Reduck was 1.7\u00d7 faster, and alone in staying on its tool.",
		"Hermes' browser failed where a site checks for automation: IMDb showed it an image CAPTCHA, and it found none of the 57 films. Reduck acts from inside the user's own Chrome and found all 57 in 1:16.",
		"Hermes with Sonnet 5.5, Reduck at 4 scripts at once, one run per task: a first read, not a verdict."
	],
	findings: [
		"Hermes' own browser is a second Chrome, which Hermes starts on a copy of the user's profile (so with the same sign-ins) and drives over the DevTools Protocol. The sites see an automated browser: IMDb showed it an image CAPTCHA, and Google its CAPTCHA after a few searches. Reduck acts from inside the user's own Chrome, through its extension, and met none of these checks on these tasks.",
		"On the invoices, Hermes' agent read Cursor's PDF link from the page, then downloaded it with curl from the terminal: the link was public, so the browser was not needed. It passed the check, but the run is no test of the browser tool, and the comparison leaves it out. Reduck's agent stayed on its scripts: one to list each site's invoices, one to download each PDF.",
		"The agent never tried to solve or get around a CAPTCHA: it stopped and said why. Hermes solves CAPTCHAs only on paid cloud browsers (Browser Use, Browserbase), which do not carry the user's sign-ins.",
		"Where it got through, Hermes' browser cost about what Reduck did. On Reddit it took 2:35 for $0.24 against Reduck's 2:38 for $0.15; on Trustpilot 3:28 for $0.17 against 1:53 for $0.24; on Amazon 0:52 for $0.09 against 1:34 for $0.15. Its context stayed small (21k to 41k tokens): each call runs Python against the page and prints only what it needs.",
		"Reduck's extra cost is overhead, not the scripts' work: on Amazon, 7 of its 9 calls found and read scripts (the docs, the script list, the devices, two contracts, the search's filters) before the one search. Script lists, large results and the authoring guide are why it ends with more context than Hermes' browser on Trustpilot (57k against 40k) and Amazon (44k against 21k).",
		"Hermes runs its browser headless by default. In an earlier trial (its runs are not kept), Google, Reddit, IMDb and Trustpilot refused a browser that names itself HeadlessChrome. These runs give it a window, with Hermes' own browser.headed setting, as the user's Chrome has one.",
		"The trial ran Reduck at 4 scripts at once. Four runs were not kept and were run again: Reddit on Reduck, whose login to Reduck expired during the run; IMDb on Hermes' browser, whose CAPTCHA a person may have solved; Amazon on Reduck, whose prompt did not yet give the search terms; and both invoice runs, made while Reduck's Cursor script was broken. Zillow was left out: after many page loads Zillow blocked the user's browser for every tool, the checks included.",
		"The first Amazon prompt let the agent word its own search, and Reduck's agent searched for other words than the check: a valid list of other products failed. The prompt now gives the search terms and each filter word for word, and both tools passed it. A task is only as closed as its prompt.",
		"Each task keeps one run per tool, the last one that went end to end. A run is discarded when the paired browser or its MCP stopped answering, a permission prompt timed out, a check could not run, or a person may have helped. Tool use is checked on every transcript: every kept run used its own tool, and one, the invoices on Hermes' browser, also reached a site around it (marked \u26a0, left out of the comparison).",
	],
	fixes: [
		"Smaller results, first. trustpilot.com/get_reviews and imdb.com/search_titles return tens to hundreds of KB (replies, metadata, plots, image links): Hermes saves them to disk and the agent parses them in the terminal. Offer a compact output or a fields argument: it is most of Reduck's extra context and cost.",
		"Cheaper discovery. list_scripts with no argument returns about 21k characters, read_script 8k to 18k, and start_session returns the whole authoring guide (96k characters) on every call. Return a short list by default and the guide once, on request.",
		"One script per page. Trustpilot's 1-star reviews page holds the TrustScore too, but Reduck takes get_company and get_reviews: two page loads per company where one would do.",
		"Faster scripts. Read the site's embedded data or its API from the page instead of rendering and parsing the whole page, as Hermes' browser does with Python against the page.",
		"Wait for what the script reads, not for the page load. Amazon holds back the end of a load past 60 s on a page already drawn: the search failed about one run in three until lib:amazon.com waited for the results instead (v33). Its delivery-ZIP step still waits up to 30 s for the home page to finish, then sends the ZIP anyway: it should wait for the token it reads, and skip the ZIP when the page already shows it. That is 30 to 35 s of the 48 s search in this trial.",
		"Notice when a site moves. Cursor's dashboard moved to grok.com, with its invoices on a tab of their own and a new data call, and cursor.com/list_invoices failed on every run until it was fixed (v11): Reduck's agent then went around its tool with curl, a run set aside and run again once the script worked. Evals that run on a schedule would catch such a move before an agent does.",
		"A reliable paired browser. The extension stopped answering twice in one afternoon (device_error, then lost its connection to reduck.ai), and needed Chrome to be restarted: it must recover on its own."
	],
	tasks: {
		"reddit-seo-post": {
			summary:
				"Both found the post in about 2:37. Hermes' browser cost $0.24 against Reduck's $0.15. Google let the browser search for about 2 minutes, then showed its CAPTCHA, and the agent found the post with Reddit's own search in the subreddit.",
			why: [
				"Reduck ran its Google script 11 times, up to 3 at once, then read the post in a browser session it opened.",
				"The prompt asked for a Google search: the agent said when it could not use Google, and why."
			]
		},
		"invoices-cursor-zapier": {
			summary:
				"Both downloaded the right two invoices. Reduck took 0:43 for $0.13, through its own scripts; Hermes' browser took 1:12 for $0.15 and fetched Cursor's PDF with curl, outside its tool.",
			why: [
				"Reduck listed both sites' invoices in one call (cursor.com and zapier.com list_invoices), then downloaded both PDFs in another (Stripe's invoice download for Cursor, zapier.com/download_invoice).",
				"Hermes' browser printed Zapier's invoice page to PDF from the tool, as Zapier has no download button. For Cursor it opened the dashboard's invoice tab, read the Stripe PDF link and ran curl on it.",
				"Cursor bills in dollars: the task gives the 17.90 EUR the card was charged, and the check reads the $20.00 invoice of that day. Both agents found it and said why the amounts differ.",
				"The first runs of this task were not kept: Cursor's dashboard had moved to grok.com and Reduck's Cursor script failed, so both agents downloaded the PDF with curl. With the script fixed (v11), Reduck stayed on its tool; Hermes' browser did not.",
			]
		},
		"amazon-mac-stand": {
			summary:
				"Both listed the right 15 products with their ratings. Hermes' browser was 1.8× faster (0:52 against 1:34), 1.6× cheaper ($0.09 against $0.15) and ended with half the context (21k against 44k). The model took the same time on both (33 s): the gap is one Reduck script that waited 30 s for nothing.",
			why: [
				"Hermes' browser built the filtered results URL itself, read the 15 cards in page code and checked one product page: 7 calls, 12 s of tool time, no wall.",
				"Earlier the same day the same search failed about one run in three, on Amazon pages that never finish loading; lib:amazon.com v33 stopped the failures by waiting for the results instead, but kept the 30 s wait before setting the ZIP.",
				"Reduck's search-products took 48 s, and 30 s of it was a wait: before it searches, the script sets the delivery ZIP from Amazon's home page, and it waits for that page to finish loading. Amazon's home page never finished, so the script waited its full 30 s, then set the ZIP anyway (it worked), although the page already showed that ZIP. The rest: the ZIP request 5 s, the results page 7 s.",
				"The model's time was the same on both sides: 32.6 s for Reduck, 33.4 s for Hermes' browser. Reduck's discovery calls (the docs, the script list, two contracts) took about 1 s of tool time, but added 74k tokens to read: that is its higher cost, not its lower speed.",
			]
		},
		"trustpilot-vpns": {
			summary:
				"Both had the 8 TrustScores right. Reduck was 1.8× faster (1:53 against 3:28); Hermes' browser was 1.4× cheaper ($0.17 against $0.24) and ended with less context (40k against 57k).",
			why: [
				"Hermes' browser opened one company page, then went through the 8 companies' pages in Python loops, reading 1-star reviews over 2 pages each, and once more to keep only the genuine 1-star ones.",
				"Reduck ran get_company and get_reviews for the 8, two batches of 8, then parsed the large review results in the terminal.",
			]
		},
		"imdb-deep-filter": {
			summary:
				"Reduck found all 57 films in 1:16 for $0.35. Hermes' browser met IMDb's bot check, an image CAPTCHA, waited about 5 minutes for it to go away, and stopped with none: 6:26 in all, for $0.10.",
			why: [
				"Reduck ran its IMDb search script for each language in two batches, the second with wider dates to check the edges; the results are most of its 96k of context.",
				"Hermes' browser loaded one search page, then got the CAPTCHA on every page after it, in its own session and in its local-profile one. It said it would not try to get past it.",
			]
		}
	}
};
