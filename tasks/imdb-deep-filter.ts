import { reduck, type Task } from "../task.ts";

// No sign-in. Six filters of IMDb's advanced search, each behind its own panel, a sort, and a
// result longer than the 50 titles IMDb shows before "50 more" (57 on 2026-11-06).
const FILTERS = {
	titleTypes: ["feature"],
	releaseDateStart: "2015-01-01",
	releaseDateEnd: "2024-12-31",
	userRatingMin: 7.0,
	minVotes: 10000,
	runtimeMaxMinutes: 130,
	languages: ["ko", "ja"],
	sortBy: "user_rating",
	sortOrder: "desc",
	count: 250
};
const TITLE = /\b(tt\d{7,8})\b/g;

export default {
	id: "imdb-deep-filter",
	name: "Every well-rated Korean and Japanese film of the last decade",
	prompt: [
		"On IMDb, list every feature film released from 2015 to 2024 whose primary language is Korean or Japanese, rated 7.0 or more, with at least 10,000 votes, and running 130 minutes or less.",
		"Sort them by rating. For each film: title, year, rating, number of votes and its IMDb link. Don't miss any."
	].join("\n"),
	// Ratings and vote counts move while a run lasts, so a title at a threshold can enter or
	// leave the list: the truth is read right after the run, and 90% each way passes.
	check: async ({ answer }) => {
		const args = Object.fromEntries(
			Object.entries(FILTERS).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
		);
		const { titles } = await reduck("reduck/imdb.com/search_titles", args);
		const expected = new Set<string>(titles.map((t: any) => t.titleId));
		const found = new Set([...answer.matchAll(TITLE)].map((m) => m[1]));
		const hits = [...found].filter((id) => expected.has(id)).length;
		const extra = found.size - hits;
		const recall = expected.size ? hits / expected.size : 0;
		const precision = found.size ? hits / found.size : 0;
		return {
			pass: recall >= 0.9 && precision >= 0.9,
			detail: `${hits}/${expected.size} films, ${extra} outside the filters`
		};
	}
} satisfies Task;
