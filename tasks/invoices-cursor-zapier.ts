import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Task } from "../task.ts";

// Two invoices on two sites signed in as the same person: each a billing page, a list of
// invoices to pick one from by date and amount, and a PDF to download. The browser must be
// signed in to both (no whoami script for either to assert it). The prompt gives each as a bank
// statement shows it: Cursor bills $20.00, and 17.90 EUR is what the card was charged for it.
const INVOICES = [
	{
		vendor: "Cursor",
		date: "2026-01-16",
		amount: "17.90",
		currency: "EUR",
		// The only Cursor invoice of that day, in its own currency.
		pdf: [/cursor|anysphere/i, /January 16, 2026/, /\$20\.00/]
	},
	{
		vendor: "Zapier",
		date: "2025-11-25",
		amount: "52.78",
		currency: "EUR",
		pdf: [/zapier/i, /52[.,]78/]
	}
];

/** The text of one PDF, empty when it is no PDF pdftotext can read. */
function text(file: string): string {
	try {
		return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
	} catch {
		return "";
	}
}

export default {
	id: "invoices-cursor-zapier",
	name: "Two invoices, two billing pages",
	prompt: [
		"Download the invoices:",
		...INVOICES.map((i) => `- ${i.vendor} · ${i.date} · ${i.amount} ${i.currency}`)
	].join("\n"),
	// The run must leave each invoice as a PDF whose text is that invoice's.
	check: ({ files }) => {
		const pdfs = files.filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => ({ f, t: text(f) }));
		const missing: string[] = [];
		const found: string[] = [];
		for (const i of INVOICES) {
			const pdf = pdfs.find((p) => i.pdf.every((re) => re.test(p.t)));
			if (pdf) found.push(`${i.vendor} in ${basename(pdf.f)}`);
			else missing.push(`${i.vendor} ${i.date}`);
		}
		return {
			pass: missing.length === 0,
			detail: missing.length
				? `no PDF for ${missing.join(", ")} among ${pdfs.length} PDFs`
				: found.join(", ")
		};
	}
} satisfies Task;
