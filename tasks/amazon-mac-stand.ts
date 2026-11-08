import { reduck, type Task } from "../task.ts";

// Three refinements of Amazon's left column, a price range and a sort, then 15 products read
// off the result: what an agent has to get right is the search itself, and the check can read
// the same search. No sign-in and no review filter, which Amazon withholds from an account it
// flags for reading many reviews pages.
const SEARCH = {
	query: "laptop stand for macbook pro 14 aluminum adjustable",
	sort: "exact-aware-popularity-rank",
	price_min: 25,
	price_max: 60,
	// Material: Aluminum; Special Features: Adjustable; Customer Reviews: 4 Stars & Up
	refinements: ["p_n_g-1004162017091:11424262011", "p_n_g-1003561633111:58126392011", "p_72:1248915011"]
};
const ASIN = /\b(B0[A-Z0-9]{8})\b/;
/** A star rating as written in an answer line: 4.6, never a part of a price ($34.99). */
const RATING = /(?<![\d$.])([1-5]\.\d)(?!\d)/g;
const asArgs = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

type Item = { asin: string; rating: number | null; sponsored: boolean };

/** One page of the search. Amazon's results page sometimes never finishes loading in the paired
 *  browser (the script stops at 60 s): the answer key tries again, as no run should fail for it. */
async function search(page: number, tries = 3): Promise<Item[]> {
	try {
		return (await reduck("reduck/amazon.com/search-products", asArgs({ ...SEARCH, page }))).items;
	} catch (e) {
		if (tries <= 1) throw e;
		return search(page, tries - 1);
	}
}

/** The first 20 organic results the filters give now, pages 1 and 2, with their rating. */
async function bestSellers(): Promise<Map<string, number | null>> {
	const top = new Map<string, number | null>();
	for (const page of [1, 2]) {
		const items = await search(page);
		for (const i of items) if (!i.sponsored && !top.has(i.asin) && top.size < 20) top.set(i.asin, i.rating);
	}
	return top;
}

export default {
	id: "amazon-mac-stand",
	name: "15 MacBook stands, from one filtered search",
	// The search terms and each filter are given word for word: the check reads that one search,
	// and an agent free to word its own query lists other products.
	prompt: [
		'On amazon.com, search for "laptop stand for macbook pro 14 aluminum adjustable" with these filters from the left column: Material Aluminum, Special Features Adjustable, Customer Reviews 4 Stars & Up, and a price from $25 to $60. Sort by Best Sellers.',
		"Take the first 15 results in the order Amazon lists them, leaving out sponsored ones only. One line per product: its ASIN, name, price, star rating, number of ratings and link.",
		"Then recommend one, and say why."
	].join("\n"),
	// Amazon reorders best sellers between fetches, so 12 of the 15 in its top 20 now is enough,
	// and a rating may move by 0.1 while a run lasts. The price and the counts move too often to
	// grade; the recommendation is a person's call (`pnpm grade`).
	check: async ({ answer }) => {
		const lines = new Map<string, string>();
		for (const line of answer.split("\n")) {
			const asin = line.match(ASIN)?.[1];
			if (asin && !lines.has(asin)) lines.set(asin, line);
		}
		if (lines.size < 15) return { pass: false, detail: `${lines.size} products, needs 15` };
		const top = await bestSellers();
		const inTop = [...lines.keys()].filter((a) => top.has(a));
		const rated = inTop.filter((a) => {
			const truth = top.get(a);
			const said = [...lines.get(a)!.matchAll(RATING)].map((m) => Number(m[1]));
			return truth != null && said.some((r) => Math.abs(r - truth) <= 0.1);
		});
		return {
			pass: inTop.length >= 12 && rated.length >= inTop.length - 1,
			detail: `${lines.size} products, ${inTop.length} in Amazon's top 20 for the filters, ${rated.length} with their rating right`
		};
	}
} satisfies Task;
