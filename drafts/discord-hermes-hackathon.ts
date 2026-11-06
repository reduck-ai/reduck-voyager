import { all, reduck, signedInAs, type Task } from "../task.ts";

// Discord's search is a box of typed operators (from:, in:) whose results load as you scroll,
// and the answers sit in a server only a signed-in member can read.
const LINK = /discord\.com\/channels\/(\d+)\/\d+\/\d+/g;

async function nousGuild(): Promise<string | null> {
	const { servers } = await reduck("reduck/discord.com/list_servers");
	return servers?.find((s: any) => /nous/i.test(s.name))?.guildId ?? null;
}

export default {
	id: "discord-hermes-hackathon",
	name: "The Hermes hackathon, from the Nous Research Discord",
	prompt: [
		"On the Nous Research Discord, find the current Hermes hackathon: its theme, its dates, the prizes, the judging criteria and how to submit.",
		"Use the announcements and what the organizers posted, not what other members say about it.",
		"Quote the message each answer comes from, with its link."
	].join("\n"),
	requires: async () => {
		const signedIn = await all([
			signedInAs(
				"Discord",
				"reduck/discord.com/whoami",
				(r) => r.username,
				process.env.VOYAGER_DISCORD_USERNAME!
			)
		]);
		if (!signedIn.pass) return signedIn;
		return (await nousGuild())
			? { pass: true }
			: { pass: false, detail: "the account is not a member of the Nous Research server" };
	},
	// Whether the content is right is a person's call (`pnpm grade`): this only fails a run whose
	// answer is not sourced from the server's messages.
	check: async ({ answer }) => {
		const guild = await nousGuild();
		const links = [...answer.matchAll(LINK)].filter((m) => m[1] === guild);
		return links.length >= 3
			? { pass: true, detail: `${links.length} message links, to be graded by a person` }
			: { pass: false, detail: `${links.length} links to the Nous server's messages, needs 3` };
	}
} satisfies Task;
