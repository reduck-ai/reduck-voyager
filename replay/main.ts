import type { CaptureResult } from "posthog-js";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.body });

// rd_vid is the visitor id the Cloudflare Worker sets on .reduck.ai and logs with every request.
// Sending it with every event lets PostHog and the Cloudflare logs be joined. It is read from the
// cookie when each event is sent, not once at load: tabs opened together each get a Set-Cookie and
// the last one wins, so an id read at load can be stale. With several rd_vid cookies, the first
// one holding a valid UUID wins, as in the Worker.
const readRdVid = (): string | undefined =>
	[...document.cookie.matchAll(/(?:^|;\s*)rd_vid=([^;]*)/g)]
		.map((m) => (m[1] ?? "").trim())
		.find((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v));

// Recordings ($snapshot) are left alone. Never throws: an event is never lost to this.
const sendCurrentRdVid = (event: CaptureResult | null): CaptureResult | null => {
	try {
		if (!event || event.event === "$snapshot") return event;
		const visitorId = readRdVid();
		if (visitorId) event.properties.rd_vid = visitorId;
		else delete event.properties.rd_vid;
	} catch {
		// keep the event as it is
	}
	return event;
};

// Visits of the published site go to reduck.ai's PostHog project (same key and options as the
// app), told apart by `$host`. Only there: `pnpm replay` serves the raw, unscrubbed runs of this
// machine, and a local `vite preview` is not a visit. Loaded after the page, off its critical path.
if (import.meta.env.PROD && window.location.hostname === "voyager.reduck.ai") {
	void import("posthog-js").then(({ posthog }) => {
		posthog.init("phc_xxcVuOqPu8oN5GwIB5C89jOvU4wtHdngdA5U3pCS3ig", {
			api_host: "https://eu.i.posthog.com",
			person_profiles: "identified_only",
			defaults: "2026-01-30",
			disable_surveys: true,
			before_send: sendCurrentRdVid
		});
		// An id registered by an earlier version stays in PostHog's storage: drop it, the cookie
		// is the only source.
		posthog.unregister("rd_vid");
	});
}
