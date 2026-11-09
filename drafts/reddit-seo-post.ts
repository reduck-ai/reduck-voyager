import type { Task } from "../task.ts";

// "$0 ad spend → 22K to 790K monthly organic visits in 6 months", r/GrowthHacking: the post the
// owner half-remembered (SEO, three parts, German pages for coverage).
const POST = "1wf6cgk";

export default {
	id: "reddit-seo-post",
	name: "A Reddit post from a vague memory",
	prompt:
		"On https://www.reddit.com/r/GrowthHacking/ I saw a post that talks about SEO, with 3 parts, and one of them mentioned using German for high coverage. Find it. It's recent. Use a Google search filtered on Reddit (site:) to find the post, because Google indexes it better. Give me its link.",
	check: ({ answer }) => ({
		pass: answer.includes(POST),
		detail: answer.includes(POST) ? "links the post" : "no link to the post"
	})
} satisfies Task;
