# Evaluation: pi-durable vs coding-agent as pico's engine

Date: 2026-11-18. pi at `473515f9c` (vendor/pi).

## Question

pico currently runs pi's `coding-agent` (the `pi` CLI's engine, `AgentSession`) in RPC mode. Should it run
`@earendil-works/pi-durable` instead?

## What pi-durable is

A durable agent harness (`packages/durable`, ~35k lines, built on Chord for document state). Conversations, model
turns, tool calls and app state are committed to storage before anything is shown. If the process dies mid-turn,
reopening the storage continues the work. It has its own extension API (tools, prompt sections, hooks, wraps, durable
tasks), an `ExecutionEnv` abstraction for files and shell, watchable state for UIs, subagents, signals, parked tools,
compaction, code mode. It is marked **Experimental** ("API changes without notice").

It is the engine of pi's next-generation apps: `apps/p2` (prototype, "will be gone soon") and `apps/p3` / "Pi Roam"
(being designed: a personal pi instance with session workers on a server, Radius for backups and remote access). The
team's phone use is a browser on such an instance; there is no on-device app in their plans.

## What we measured (spike: `runtime/spikes/durable.ts`)

A Harness with DeepInfra (`DeepSeek-V4-Flash`), durable's `CodingTools`, durable's `NodeExecutionEnv` over pico's Node
shims, and durable's JSONL storage, in pico's JavaScriptCore host on macOS.

| | coding-agent (M0) | pi-durable (spike) |
|---|---|---|
| Bundle | 13.6 MiB | 2.0 MiB (0.9 MiB core without Node env/storage) |
| Evaluate bundle (Mac, debug host) | ~330 ms | ~60 ms |
| Node built-ins needed | ~45 modules, deep (fs, child_process, stream, readline, http, ...) | none in the core; only in `env/node`, `storage/*/node`, `images/node` |
| read / write / edit / bash with DeepInfra | works | works |
| Restart and continue a conversation | works (session file) | works (storage reopened, 12 ms) |
| Kill (SIGKILL) during a tool call | in-flight turn lost; user re-prompts | `resume()` continues the run; the cut-off `bash` call is reported as "interrupted and may have partially run"; the model checked and finished |
| Session files interchangeable with desktop `pi` | yes | no (different storage model) |
| pi CLI extensions (`ExtensionAPI`) | yes | no (durable has its own extension API) |
| AGENTS.md, skills, prompt templates, slash commands, models.json, auth.json | built in | not in durable; p2 implements them as plugins tied to its server kit |
| UI protocol | RPC JSONL events | `conversation.watch()`: views plus Chord ops, transcript windowing, reconnect |
| Storage | JSONL session files | pluggable: memory, JSONL, SQLite (4-method async adapter), IndexedDB |
| API stability | stable, the shipped CLI | experimental; 66 commits to durable/src since 2026-10-15, last one today |

## Why durability matters on a phone

iOS suspends an app shortly after it leaves the foreground and kills suspended apps freely (memory pressure, updates).
A long agent run will regularly be cut off. With coding-agent the stream breaks, the turn is lost, and the user retries.
With durable the run continues on the next launch (or in a background task), retries are bounded (`restartLimit`), and
tools that are unsafe to replay are reported to the model as interrupted instead of silently rerun.

## Costs of switching

1. **Product layer to build.** durable is an engine. pico would provide: system prompt (coding-agent's is 228 lines),
   AGENTS.md / context files, skills (505 lines), prompt templates and slash commands (341 lines), model and auth
   config, compaction settings, session list. Much of coding-agent's loader code is plain TypeScript over `fs` and can
   be reused through the existing shims, wrapped as durable extensions, keeping the **file formats** compatible
   (`~/.pi/agent/skills`, `AGENTS.md`, `models.json`).
2. **Lost compatibility.** Session files are not shared with desktop pi, and pi CLI extensions do not load. Durable
   extensions are a different API.
3. **Moving target.** Pinning the submodule contains churn, but every update may need porting.

## Costs of staying

1. 13.6 MiB bundle and ~45 shimmed Node modules to maintain; startup on an iPhone without JIT will be several times
   the Mac's 330 ms.
2. No recovery from suspension or kills; building that on top of AgentSession would duplicate what durable does.
3. Diverges from where pi is heading (p3 is durable + Chord).

## Recommendation

Switch to pi-durable, pinned, and keep compatibility at the level of files rather than sessions:

- Engine: durable Harness with SQLite storage (Swift sqlite3 adapter) or JSONL.
- Environment: a pico `ExecutionEnv` implemented directly on the Swift host (no Node shims needed in the hot path);
  `bash` through ios_system, later a remote sandbox env (durable already models per-conversation environments).
- Product layer as durable extensions: coding system prompt, AGENTS.md, skills, prompt templates, reusing coding-agent's
  loaders where they are pure.
- UI: SwiftUI over `watch()` views.

Keep the M0 coding-agent path working as a fallback until the durable path reaches parity.

## Open questions for the owner

- Is losing session interchange with desktop pi acceptable? (Export to pi's session format is possible later.)
- Is losing pi CLI extension compatibility acceptable? (Durable extensions are the future API for p3.)
