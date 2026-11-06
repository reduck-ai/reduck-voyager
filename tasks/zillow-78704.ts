import { reduck, type Task } from "../task.ts";

// No sign-in. Zillow sits behind an anti-bot wall, draws its results on a map, and its filters
// sit in dropdowns: the list has to be read in full, page after page.
const FILTERS = {
	location: "78704",
	status: "for_sale",
	homeTypes: ["houses"],
	minBeds: 3,
	minBaths: 2,
	minPrice: 600000,
	maxPrice: 900000,
	sort: "days"
};
const ZPID = /(\d{6,12})_zpid/g;
const asArgs = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

/** Every house the filters match now inside 78704, all pages. */
async function truth(): Promise<Set<string>> {
	const ids = new Set<string>();
	for (let page = 1; page <= 20; page++) {
		const { results } = await reduck("reduck/zillow.com/search", asArgs({ ...FILTERS, page }));
		for (const r of results) if (!r.nearby) ids.add(r.zpid);
		if (results.length < 41) return ids;
	}
	return ids;
}

export default {
	id: "zillow-78704",
	name: "Every family house for sale in Austin's 78704",
	prompt: [
		"On Zillow, list every house for sale in ZIP code 78704 (Austin, TX) priced from $600,000 to $900,000, with at least 3 bedrooms and 2 bathrooms.",
		"Houses only, not condos or townhomes. Leave out listings outside 78704. Newest first.",
		"For each one: address, price, beds, baths and its Zillow link. Don't miss any."
	].join("\n"),
	// Listings come and go by the hour: the truth is read right after the run, and a run passes
	// on 80% of it with 80% of its links right.
	check: async ({ answer }) => {
		const found = new Set([...answer.matchAll(ZPID)].map((m) => m[1]));
		const expected = await truth();
		const hits = [...found].filter((id) => expected.has(id)).length;
		const recall = expected.size ? hits / expected.size : 0;
		const precision = found.size ? hits / found.size : 0;
		return {
			pass: recall >= 0.8 && precision >= 0.8,
			detail: `${hits}/${expected.size} houses, ${found.size - hits} outside the filters`
		};
	}
} satisfies Task;
