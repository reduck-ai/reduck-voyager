import { all, reduck, signedInAs, type Task } from "../task.ts";

// Six filters of LinkedIn's jobs search, behind a sign-in, and every page of the result.
const FILTERS = {
	keywords: "backend engineer",
	location: "France",
	datePosted: "pastWeek",
	experienceLevels: ["mid_senior"],
	workplaceTypes: ["remote", "hybrid"],
	under10Applicants: true,
	easyApply: true
};
const JOB = /linkedin\.com\/jobs\/view\/(\d+)/g;

/** Every posting the filters match now, all pages. */
async function truth(): Promise<Set<string>> {
	const ids = new Set<string>();
	for (let page = 1; ; page++) {
		const args = Object.fromEntries(
			Object.entries({ ...FILTERS, page }).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
		);
		const { jobs, total } = await reduck("reduck/linkedin.com/search_jobs", args);
		for (const j of jobs) ids.add(j.jobId);
		if (!jobs.length || page * 25 >= total) return ids;
	}
}

export default {
	id: "linkedin-jobs",
	name: "Every fresh remote backend job in France with few applicants",
	prompt: [
		"On LinkedIn, list every backend engineer job in France posted in the past week that is mid-senior level, remote or hybrid, has fewer than 10 applicants and offers Easy Apply.",
		"For each job: title, company, location and its link. Don't skip any page of results."
	].join("\n"),
	requires: () =>
		all([
			signedInAs(
				"LinkedIn",
				"reduck/linkedin.com/whoami",
				(r) => r.username,
				process.env.VOYAGER_LINKEDIN_USERNAME!
			)
		]),
	// Postings open and close by the minute: the truth is read right after the run, and a run
	// passes on 80% of it with 80% of its links right.
	check: async ({ answer }) => {
		const found = new Set([...answer.matchAll(JOB)].map((m) => m[1]));
		const expected = await truth();
		const hits = [...found].filter((id) => expected.has(id)).length;
		const recall = expected.size ? hits / expected.size : found.size ? 0 : 1;
		const precision = found.size ? hits / found.size : 1;
		return {
			pass: recall >= 0.8 && precision >= 0.8,
			detail: `${hits}/${expected.size} jobs found, ${found.size - hits} outside the filters`
		};
	}
} satisfies Task;
