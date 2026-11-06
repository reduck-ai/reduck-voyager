import { all, reduck, signedInAs, type Task } from "../task.ts";

// Three refinements of Amazon's left column, a price range and a sort, then the 1-2 star
// reviews of verified purchases of 15 products: Amazon filters reviews by star and by verified
// purchase only for a signed-in account, and 15 products is where running them in parallel
// tells.
const SEARCH = {
	query: "laptop stand for macbook pro 14 aluminum adjustable",
	sort: "exact-aware-popularity-rank",
	price_min: 25,
	price_max: 60,
	// Material: Aluminum; Special Features: Adjustable; Customer Reviews: 4 Stars & Up
	refinements: ["p_n_g-1004162017091:11424262011", "p_n_g-1003561633111:58126392011", "p_72:1248915011"]
};
const ASIN = /\b(B0[A-Z0-9]{8})\b/g;
const asArgs = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

/** The first 20 organic best sellers the filters give now, pages 1 and 2. */
async function bestSellers(): Promise<string[]> {
	const asins: string[] = [];
	for (const page of [1, 2]) {
		const { items } = await reduck("reduck/amazon.com/search-products", asArgs({ ...SEARCH, page }));
		for (const i of items) if (!i.sponsored && !asins.includes(i.asin)) asins.push(i.asin);
	}
	return asins.slice(0, 20);
}

export default {
	id: "amazon-mac-stand",
	name: "15 MacBook stands, by their worst reviews",
	prompt: [
		'On amazon.com, search for laptop stands for a MacBook Pro 14": aluminum, adjustable, 4 stars & up, priced $25 to $60, sorted by best sellers. Leave out sponsored results.',
		"Take the top 15. For each one, read its 1- and 2-star reviews from verified purchases only, and tell me the most common complaint.",
		"Then recommend one. Give the ASIN and the link of each product."
	].join("\n"),
	requires: () =>
		all([
			signedInAs(
				"Amazon",
				"reduck/amazon.com/get_current_user",
				(r) => r.firstName,
				process.env.VOYAGER_AMAZON_NAME!
			)
		]),
	// Whether each complaint is the right one is a person's call (`pnpm grade`). The check fails
	// a run that did not cover 15 products of this search: Amazon reorders best sellers between
	// fetches, so 12 of them in its top 20 now is enough.
	check: async ({ answer }) => {
		const found = [...new Set([...answer.matchAll(ASIN)].map((m) => m[1]))];
		if (found.length < 15) return { pass: false, detail: `${found.length} products, needs 15` };
		const top = await bestSellers();
		const inTop = found.filter((a) => top.includes(a)).length;
		return {
			pass: inTop >= 12,
			detail: `${found.length} products, ${inTop} in Amazon's top 20 for the filters`
		};
	}
} satisfies Task;
