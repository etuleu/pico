# pico: pi on iPhone

Goal: run the pi coding agent (https://github.com/earendil-works/pi) natively on iPhone.
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

## Open questions / risks

- Size and behavior of the Node shim layer (resolved by M0).
- Native deps in coding-agent (`@silvia-odwyer/photon-node` image processing, `undici`) need replacements.
- Extension loading via jiti in an interpreter-only JSC: may be slow.
- App Store review: ios_system and WASM commands are accepted in a-Shell, but must be checked
  before submission.
