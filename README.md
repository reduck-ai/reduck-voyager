# Reduck Voyager

Evals for AI agents on real browser tasks, by [Reduck](https://reduck.ai). Results: https://voyager.reduck.ai.

An open-source framework that tests agents on real knowledge work in the browser: market research, SEO, go-to-market. Define an eval in one file, run it, read every step, and share the results.

The same agent gets the same prompt twice, once per **arm**, with exactly one browser tool:

- **reduck**: the [Reduck](https://reduck.ai) MCP server, which runs saved browser scripts.
- **chrome**: Claude in Chrome (`--chrome`).

A run is one Claude Code session through the Agent SDK (the `claude_code` system prompt). The arms differ in one sentence of the prompt ("Use Reduck MCP." or "Use Claude for Chrome MCP.") and in the one browser tool the session gets; `--strict-mcp-config` and `ENABLE_CLAUDEAI_MCP_SERVERS=false` keep any other MCP server out of both. Every run keeps its Claude Code transcript, so any result can be checked against what the agent did.

## Words

- **Task**: a prompt, plus optional code: `requires` (what must hold before a run means anything) and `check` (the verdict).
- **Run**: one task on one arm. Its id is `<trial>/<task>.<arm>`.
- **Trial**: the runs of one `pnpm bench` call, in `runs/<time>/`, at most one per task and arm: what the page compares.
- **Verdict**: `{ pass, detail, by }`, given by the task's `check`, a model it asks, or a person (`pnpm grade`).

## Your first eval

1. Copy `tasks/example.ts` to `tasks/<id>.ts`: a prompt and, when the answer can be checked by code, a `check`.
2. If it needs a signed-in site, add a `requires` with `signedInAs`, the account read from an environment variable of yours.
3. `pnpm bench --task <id>`: both arms, one trial.
4. `pnpm replay`: read both runs, step by step. `pnpm grade` them if the task has no `check`.
5. To share the results, publish them (below).

Everything else is the tool: nothing to register, no runner flag.

## Tasks

A task is a file in `tasks/` that default-exports a `Task` (or a list of them):

```ts
{
  id: "hn-dropbox",
  name: "The Dropbox launch post on Hacker News",
  prompt: "Find the Hacker News post where Dropbox's founder first showed it…",
  requires?: () => Verdict,   // checked before every run; the run is skipped if it fails
  check?: (run) => Verdict,   // from the answer, the parsed session and the downloaded files
}
```

See `tasks/example.ts`. `task.ts` has the helpers: `signedInAs` (assert the exact account a site is signed in as), `all`, `reduck` (run a Reduck script from a check), `pdfText`.

A task in `tasks/` is public: its file is committed and its runs can go on the site. It names no account: the ones it needs come from the environment (`VOYAGER_X_HANDLE`, the X account `browser-agent-pains` and `viral-founders` must be signed in as). A task that carries personal data goes in `tasks/private/`, git-ignored, so each person keeps their own; its runs are never published. So does `tasks/private/deny.txt`, the strings of yours that must never be published, one per line: publishing does not run without it.

## Run

Requirements: Node 22.18+, pnpm, [Claude Code](https://claude.com/claude-code), `pdftotext` (poppler: `brew install poppler`) for the checks that read a PDF, Chrome with the Reduck extension paired and Claude in Chrome installed. Both arms, and the `requires` checks, drive the same Chrome profile, so its sign-ins are the test fixture.

```sh
pnpm install
npx @reduck-ai/cli@latest login                              # or set REDUCK_API_KEY
pnpm bench                                                   # every task, both arms
pnpm bench --task hn-dropbox --arm reduck --timeout 10       # minutes per run, default 15
pnpm bench --task hn-dropbox --arm chrome --trial <folder>   # join that trial, next to its reduck run
pnpm clean-downloads --since <ISO time> [--dry-run]          # delete PDFs a run left in ~/Downloads
pnpm check                                                   # svelte-check: the .ts files and the app
```

- `REDUCK_MCP_URL` points the reduck arm and the `requires` checks at another Reduck MCP (default `https://mcp.reduck.ai`). `REDUCK_API_KEY`, when set, is used instead of the CLI's OAuth login, which lives one hour and is refreshed before each run.
- Runs are sequential because both arms download into the same `~/Downloads`: every file that appears there during a run is moved into `runs/<time>/<task>.<arm>/files/`.
- Each call appends one row per run to `runs/<time>/results.jsonl`: verdict, outcome, wall time, turns, cost, usage, files, the transcript's path and the answer, or `skipped` with the reason.
- Importing `run.ts` starts the benchmark. To try a task's `requires` or `check`, import the task file and call them.

## What a run is scored on

- **Verdict**: see above.
- **Time**: wall time of the session.
- **Cost**: what Claude Code billed, side models included (the SDK's `total_cost_usd`).
- **Final context**: the tokens in the model's context when the task ends: the last API call's prompt (input + cache read + cache write) plus its output, read from the transcript's `usage`. It equals the SDK's `getContextUsage()` total plus the last answer. It can be too high by the last reply's thinking, never too low.

## Read, grade and replay

- `pnpm replay` serves a page with one card per task: who did better in its latest trial, and by how much. Opening a trial replays its runs side by side on one timeline: the chat, the browser screenshots, and a result card when each run ends. Live, it shows every run on your machine at any stage: a switch at the top right moves the page between raw, draft and published in place, and `?run=<id>@raw&run=<id>@draft` puts one run's transcript next to its draft on one timeline. Built, it shows the published runs alone.
- `pnpm grade <run id>` runs the task's check again; `pnpm grade <run id> pass|fail "<why>"` records a person's verdict, for a task no code can grade.
- `mcp.ts` is an MCP server over the transcripts and the runs, so an agent can check a run step by step, screenshots included:

  ```sh
  claude mcp add -s user claude-sessions-parser -- node <path>/reduck-voyager/mcp.ts
  ```

  `list_runs`, `read_session` and `read_step` (a run at any stage: raw transcript, draft, published), `export_run`, `redact_export`, and `list_sessions` for any other Claude Code session.

## Publish

A trace can hold private data no rule foresees, so a run goes public by name, in three steps:

```
transcript (never edited)
   │  pnpm export <run id> …               scrubbed, screenshots dropped → exports/<id>.json (git-ignored)
   ▼
draft      read whole (read_session stage: "draft"), redacted (redact_export) until clean
   │  pnpm export --approve <run id> …     a person's yes; moved → replay/public/data/<id>.json
   ▼
published  never edited; commit and push to main: GitHub Pages builds the site from it
```

- Only a run of a public task can be drafted.
- The scrub rewrites what a machine puts in every trace: the home directory, the temp directory, Google's CAPTCHA IP, every email address.
- Every line of `tasks/private/deny.txt` (your emails, handles, names) is reported in a draft and refused at approval, for every published file, not only the new ones.
- `pnpm export --approve` alone rebuilds `tasks.json`, the site's index, from the folder: delete a published file and run it to unpublish.

## License

MIT
