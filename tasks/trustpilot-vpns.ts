import { reduck, type Task } from "../task.ts";

// No sign-in. Eight companies, each a profile and a filtered review list: the same few steps
// eight times over, where parallel script runs should tell against one browser going through
// them in turn.
const VPNS: Record<string, string> = {
	NordVPN: "nordvpn.com",
	ExpressVPN: "expressvpn.com",
	Surfshark: "surfshark.com",
	"Proton VPN": "protonvpn.com",
	CyberGhost: "cyberghostvpn.com",
	"Private Internet Access": "privateinternetaccess.com",
	IPVanish: "ipvanish.com",
	Mullvad: "mullvad.net"
};

export default {
	id: "trustpilot-vpns",
	name: "Eight VPNs, by their Trustpilot complaints",
	prompt: [
		`On Trustpilot, for each of these VPN providers: ${Object.entries(VPNS).map(([n, d]) => `${n} (${d})`).join(", ")}.`,
		"Give its TrustScore and its total number of reviews, then read its 1-star reviews and tell me the most common complaint.",
		"One line per provider, then say which one has the fewest serious complaints."
	].join("\n"),
	// The complaint is a person's call (`pnpm grade`). The check fails a run that did not read
	// the profiles: each provider's line must carry its TrustScore as Trustpilot shows it now.
	check: async ({ answer }) => {
		const lines = answer.split("\n");
		const wrong: string[] = [];
		for (const [name, domain] of Object.entries(VPNS)) {
			const { trustScore } = await reduck("reduck/trustpilot.com/get_company", { domain });
			const score = Number(trustScore).toFixed(1);
			const key = name.split(" ")[0].toLowerCase();
			const mine = lines.filter((l) => l.toLowerCase().includes(key) || l.includes(domain));
			if (!mine.some((l) => l.includes(score))) wrong.push(`${name} (TrustScore ${score})`);
		}
		return {
			pass: wrong.length <= 1,
			detail: wrong.length ? `TrustScore missing or wrong for ${wrong.join(", ")}` : "8/8 TrustScores right"
		};
	}
} satisfies Task;
