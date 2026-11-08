import type { Task } from "../task.ts";

// No sign-in. One product on three stores, each with its own search, filters and product page:
// three interfaces for a browser, three scripts for Reduck.
const STORES = [
	{ name: "Amazon", link: /amazon\.com\/(?:[^\s)]*\/)?dp\/[A-Z0-9]{10}/ },
	{ name: "Walmart", link: /walmart\.com\/ip\/[^\s)]*\d{5,}/ },
	{ name: "eBay", link: /ebay\.com\/itm\/(?:[^\s)]*\/)?\d{9,}/ }
];

export default {
	id: "headphones-3-stores",
	name: "One pair of headphones, three stores",
	prompt: [
		"Find the best price for new Sony WH-1000XM5 headphones (black) on Amazon, Walmart and eBay.",
		"On Amazon and Walmart, the product sold new. On eBay, the cheapest Buy It Now listing in new condition, shipping included.",
		"For each store: the price, the seller, and the link. Then tell me where to buy it."
	].join("\n"),
	// Prices move by the hour and the stores disagree on titles, so the check asks only that each
	// store was reached: a product link on each. Whether each is the right product at the right
	// price is a person's call (`pnpm grade`).
	check: ({ answer }) => {
		const missing = STORES.filter((s) => !s.link.test(answer)).map((s) => s.name);
		return {
			pass: missing.length === 0,
			detail: missing.length ? `no product link for ${missing.join(", ")}` : "a product link on each of the 3 stores"
		};
	}
} satisfies Task;
