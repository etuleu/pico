# pico: pi on iPhone

Goal: run the pi coding agent (https://github.com/earendil-works/pi) natively on iPhone.

See `PRINCIPLES.md` for how we build it (files like Linux, keep it simple, user first, no concentration of power)
and `docs/concepts.md` for what agents, chats and runs are and what each can see.
No laptop or server dependency. Personal use first; App Store later if it proves useful.

## Requirements

- Runs fully on-device by default.
- Keep compatibility with pi as much as possible: same agent loop, providers, tools,
  session format, skills, `~/.pi`-style config, and (eventually) extensions.
- General-purpose: not only git repos, any agent task.
- Auth: API keys only for now (stored in Keychain). OAuth logins later.
- Optional cloud sandbox for heavy compute, later (M4).

## Approach

Bundle pi's real `coding-agent` (via `createAgentSession` from `packages/coding-agent/src/core/sdk.ts`)
and run it inside JavaScriptCore, with the Node.js APIs it uses replaced by thin shims backed by Swift.

Why this is feasible:

1. Every built-in tool has a pluggable backend interface (`ReadOperations`, `EditOperations`,
   `BashOperations`, `GrepOperations`, `FindOperations`, `LsOperations`), already used by pi for SSH.
   On iPhone, `BashOperations.exec` goes through ios_system; later the cloud sandbox plugs in the same way.
2. The Node surface is small: coding-agent core uses `fs`, `path`, `os`, `events`, `crypto`, `stream`,
   `buffer`, `child_process`. `pi-ai` / `pi-agent-core` mostly need only `fetch`.

Why JavaScriptCore (JSContext) and not WKWebView or nodejs-mobile:

- JSContext is in-process, so Swift can expose synchronous APIs (`fs.readFileSync` works).
- No JIT for third-party apps, but the agent workload is I/O bound, so the interpreter is fine.
- nodejs-mobile stays as a fallback if the shim layer grows too large.

The UI talks to the engine using pi's own RPC protocol (`packages/coding-agent/docs/rpc.md`) over an
in-process channel. Side effect: the UI can be developed and tested against `pi --mode rpc` on a Mac.

## Layout

```
pico/
  vendor/pi/   git submodule of earendil-works/pi, pinned
  runtime/     TS: esbuild bundle of pi's createAgentSession
               + node:* shims (fs, os, crypto, child_process, ...) backed by Swift
               + entry point speaking pi's RPC protocol over an in-process channel
  ios/         SwiftUI app
               - JavaScriptCore host
               - Swift bridges: fs -> app sandbox, fetch -> URLSession streaming, Keychain, timers
               - shell: ios_system (ls, grep, sed, curl, python, lua, git via libgit2)
               - chat UI rendering pi events (streaming text, tool calls, diffs)
```

## Milestones

- **M0 (spike):** pi bundle runs in JavaScriptCore inside a small macOS Swift CLI host
  (same framework as iOS, faster iteration). Done when one streaming Anthropic prompt works
  and `read` / `write` / `edit` operate on a sandbox folder. Output: list of required Node shims.
- **M1:** iOS app with JSC host, chat UI, settings / API keys (Keychain), session list.
- **M2:** `bash` via ios_system; git (clone / commit / push over HTTPS with a token).
- **M3:** Files app / folder access (security-scoped bookmarks), skills, `~/.pi`-style config,
  extensions (via jiti, performance to be measured).
- **M4:** pluggable cloud sandbox backend for `BashOperations` (and optionally file ops).

## Decisions

- pi is consumed as a git submodule at `vendor/pi`, pinned to a commit.
- API keys only for now.
- Repo: git@github.com:etuleu/pico.git

## Status

### M0: done

pi's unmodified `main(["--mode", "rpc"])` runs in JavaScriptCore via `host/` (`pico-cli` on macOS).
Verified with DeepInfra (`deepseek-ai/DeepSeek-V4-Flash`): streaming, `read` / `write` / `edit` / `bash`,
sessions. Session files are interchangeable with desktop pi (pico -> pi -> pico on one session file).

Numbers (M-series Mac, debug host): prelude 0.77 MiB, pi.js 13.6 MiB; evaluating pi.js ~350 ms.

How it fits together:

- `runtime/src/prelude/`: globals JSC lacks (timers, console, TextEncoder/Decoder, Event/AbortController,
  URL, web streams, fetch, Buffer, process, crypto). Owns the single copies of buffer/events/readable-stream.
- `runtime/src/node/`: `node:*` shims. fs, child_process, crypto, os are host-backed; http/net/worker_threads
  etc. are stubs that throw only when used.
- `runtime/build.mjs`: esbuild, IIFE, maps every `node:*` import to a shim, keeps pi's `src/` side effects,
  copies pi's assets to `dist/pkg` (`PI_PACKAGE_DIR`).
- `host/Sources/PicoHost`: `PicoRuntime` (JS thread + JSContext), `HostFS` (POSIX), `HostFetch`
  (URLSession streaming), `HostCrypto` (CryptoKit), `HostProcess` (pluggable `ProcessBackend`).
- Test: `cd runtime && npm run smoke`; agent: `pico-cli --bundle runtime/dist --cwd <dir> -- <pi args>`.

Known gaps found in M0 (to address in M1/M2):

- fd-based reads (`readSync`) re-read the whole file per call: fine for now, O(n^2) for large session files.
  Move fds into the host.
- No unhandled promise rejection reporting (the JSC API for it is private).
- `AsyncLocalStorage` only tracks synchronous scopes.
- zlib compression, `fs.watch`, http servers (OAuth callbacks), worker threads, WASM (photon, codemode) are not
  available yet.
- grep / find tools spawn `rg` / `fd`: need JS or host implementations on iOS (`GrepOperations`, `FindOperations`).
- Bundle size: jiti (2.3 MiB), highlight.js (1.5 MiB), google-genai / auth could be trimmed or lazy-loaded.

### Engine decision: pi-durable (decided 2026-11-18)

pico runs `@earendil-works/pi-durable` (pinned via the submodule), not coding-agent. See `docs/durable-evaluation.md`.
Compatibility is kept at the level of files (AGENTS.md, skills, prompt templates, models.json), not session files or
pi CLI extensions. The M0 coding-agent bundle stays buildable as a fallback until durable reaches parity.

### M1: in progress (iOS app on pi-durable)

Working in the iOS simulator (iPhone 17 Pro, iOS 27): durable engine in JavaScriptCore, DeepInfra streaming, read /
write / edit on the app's Documents folder, SwiftUI chat (tool cards, markdown, live streaming, stop), session list,
model menu, API keys in the Keychain, and automatic resume of a run cut off by the app being killed (verified by
terminating the app mid-run).

Layout:

- `runtime/src/engine/`: the engine. `protocol.ts` (JSONL commands/events, mirrored in `app/Sources/Engine/Protocol.swift`),
  `session.ts` (one durable JSONL storage per session in `~/.pi/pico/sessions/<id>/`), `config.ts` (pi-ai built-in
  providers + pi's models.json), `coding.ts` (pi's system prompt structure, AGENTS.md), `ui.ts` (view -> items).
- `app/`: XcodeGen project (`project.yml`), `run-sim.sh` builds, installs and launches on a simulator
  (`PICO_AUTOPROMPT="..."` runs one prompt, for tests).
- Engine test on the Mac: `dev/run-engine.sh <seconds> <commands.jsonl>`.

Runs on a real iPhone 17 Pro Max (team D3RVDPR3J3, bundle id `com.etuleu.pico`): `app/run-device.sh`. Engine startup
on the device: prelude 22 ms, engine.js 73 ms. Engine log: `Library/Caches/engine.log` in the app container.

Storage stays files (durable's JSONL storage, one directory per session); no SQLite until files clearly fail us.

Remaining for M1: better markdown (lists, headings, tables),
trim provider SDKs from the bundle (5.8 MiB), session rename, files browser.

### M2: in progress (shell and git)

Shell: **just-bash** (vercel-labs, Apache-2.0), a bash interpreter in TypeScript, instead of ios_system. ios_system has
no `sh`/`bash` (only single commands with pipes), needs native frameworks per command group, and adds tens of MB.
just-bash gives bash syntax (pipes, `&&`, `if`, `for`, functions, globs) and ~80 commands (grep, rg, sed, awk, find,
xargs, jq, curl via fetch, ...) in JS, identical on simulator and device. `runtime/src/engine/shell-env.ts` wraps it as
durable's `ExecutionEnv.exec()` over the real file system (`ReadWriteFs` at `/`), with /bin and /usr/bin stand-ins so
command lookup works on iOS. Verified on the iPhone.

Known gaps: no streaming output (delivered when the command ends), `tar z` needs `CompressionStream`, no python yet.

git: `runtime/src/engine/git.ts`, a `git` command in the shell on isomorphic-git (MIT, pure JS) over the real file
system and fetch: init, clone, status, add, rm, commit, log, diff, branch, checkout/switch, remote, fetch, pull, push,
config, rev-parse. Repositories are normal `.git` directories (checked with real git: same log, clean tree, fsck ok).
HTTPS auth uses GITHUB_TOKEN (Settings > Tokens, Keychain). Clone verified on the iPhone; push not yet verified.

The system prompt has an `environment` section listing what the shell can and cannot do.

### Agents (specialized subagents)

Agents are files: `~/.pi/agent/agents/<name>.md` in pi's subagent format (frontmatter `name`, `description`, `model`
as `provider/modelId`, `tools` as a comma list; the body is the instructions). Each file becomes one tool for the main
agent (one tool per agent: do one thing well). Calling it runs a child conversation owned by the call
(`runtime/src/engine/agents.ts`): fresh context (only the task text), the agent's model, tools and instructions,
and the call parks until the child answers, so it survives the app being killed. Only the final answer returns.
Tools only agents need (`perplexity_search`, `fetch` in `web.ts`) are hidden from the main conversation.

First agent: `web_search` (Perplexity Search API + fetch, DeepSeek-V4.1-Flash), installed on first launch when the
agents folder does not exist. Verified on the iPhone (fetch fallback without a Perplexity key).

Later: `context: fork` frontmatter (child starts from the parent's history), project agents (`.pi/agents`), showing a
child's steps in the tool card, counting a child's usage in the parent.

### Apps (web app previews) — for demos

The agent builds small web apps (games, animations, visualizations) as plain folders, `apps/<name>/index.html` in
the workspace, and calls the `preview` tool (`runtime/src/engine/preview.ts`): the app shows it full screen in a
WKWebView (`app/Sources/Views/PreviewView.swift`), captures `console` and uncaught errors for a moment and sends them
back to the agent (`ui-bridge.ts`: engine asks the UI, the UI answers with `preview_result`), so the agent fixes its
own runtime errors. The preview reloads when any file in the app folder changes. Finished preview cards have an
"Open" button. Triple-tap hides the controls (clean screen recordings). Motion sensors are allowed (tilt demos).

Demos built on the iPhone with Inkling-2-Small: `apps/microduck` (Hugging Face's robot duck learning tricks),
`apps/life` (glowing Game of Life), `apps/meadow` (cat, butterflies, sky by time of day). 1 to 2 minutes each.

Finding: DeepInfra sends tool-call arguments in one piece at the end (all models), so there is no live progress
while a file is written; the chat shows elapsed time instead.

## TODO (later)

- **Artifacts section.** A dedicated place in the app, like Claude's artifacts, to browse and reopen generated
  apps, documents, and other outputs. Placement and exact UI TBD.

- **Live command output.** just-bash returns a command's output only when it finishes, so a long command shows a
  spinner and then everything at once, and output of a stopped or timed-out command is lost. Durable's
  `ShellExecOptions.onOutput` and the app's tool cards already handle streamed chunks; the gap is just-bash's
  `exec()`. Options: stream from just-bash's stdout internally, or let pico's own commands (git clone/fetch/push
  progress) report through `onOutput` directly.
- `tar z` / `gzip` in the shell need `CompressionStream` (host-backed via Apple's Compression framework).
- Verify `git push` over HTTPS with a GitHub token on the device.
- **Run JavaScript.** A pico `node` command in the shell: each run gets a fresh JavaScriptCore context on its own
  thread, with pico's prelude and Node shims (fs on real files, path, fetch, Buffer, timers, process.argv), `node -e`,
  `node script.js`, CommonJS `require` of local files. Later: ES modules (transform), plain-JS packages from
  node_modules. Caveat: JSC has no public API to interrupt running code, so a timed-out script is abandoned on its
  thread. just-bash's `js-exec` (QuickJS in WASM + worker threads) is the alternative; unlikely to work on iOS as is.
- **Export a chat.** Sessions are stored in durable's commit-log format (`sessions/<id>/store/*.jsonl`), which is hard
  to read. Export from the chat (share sheet, or write into the workspace) as Markdown: user and assistant messages,
  tool calls with arguments and output, agent runs, model and cost. Optionally also the raw session folder, so it can
  be re-imported on another device.
- **Export all chats.** One action that exports every chat (a folder or zip of Markdown files, one per chat, plus an
  index; optionally the raw session folders) for backup or moving to another device.
- **Show the files of a chat.** A view per chat listing the files it created or changed (from its write / edit /
  preview calls and git clones; bash changes are harder to attribute: maybe snapshot the working folder per run), with
  open / preview / share. Ties a chat to its results ("where is the app I made in that chat?").
- **Show all files.** An in-app file browser of the workspace (and optionally the config dir `~/.pi/agent` and the
  sessions), with view, preview for HTML apps, share, rename, delete. The Files app can show the workspace, but not
  the config or the sessions, and cannot preview apps.
- **Long chats.** Today every open session is fully in memory: durable's JSONL storage replays and keeps the whole
  history, the engine loads the full transcript and resends all items to the app on changes, and SwiftUI renders the
  whole list. Ideas: send only the newest window of items plus "load earlier" (durable's `ConversationTranscript`
  already supports windows and gaps), send item diffs instead of full lists, cap rendered tool output, and rely on
  durable's compaction for model context. Measure first with a long session on the phone.
- **Markdown rendering.** `MarkdownText` (app/Sources/Views/ItemViews.swift) handles inline markdown and fenced code
  only. Add block-level parsing: headings, bullet / numbered lists (nested), block quotes, horizontal rules, tables
  (horizontally scrollable). Small native SwiftUI parser, no dependency.
- Trim the engine bundle (10.9 MiB: provider SDKs, just-bash extras like sql.js and HTML-to-markdown).

## Open questions / risks

- Size and behavior of the Node shim layer (resolved by M0).
- Native deps in coding-agent (`@silvia-odwyer/photon-node` image processing, `undici`) need replacements.
- Extension loading via jiti in an interpreter-only JSC: may be slow.
- App Store review: ios_system and WASM commands are accepted in a-Shell, but must be checked
  before submission.
