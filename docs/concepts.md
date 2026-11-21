# Concepts

What pico's core ideas mean today, as built, and the open questions. Keep this short and true to the code; update it
when a decision changes something.

## The words

**Agent**: a *definition* of a helper: instructions, a model, and tools (plus a name and a description). An agent is not
something running; it is a recipe for one.

- **Specialized agents** are files: `~/.pi/agent/agents/<name>.md` (pi's subagent format: frontmatter `name`,
  `description`, `model`, `tools`; the body is the instructions). Each one becomes a tool the main agent can call.
- **The main agent** ("pico") is the one you talk to in a chat. Today it is defined in code, not in a file: pico's
  built-in prompt sections (`runtime/src/engine/coding.ts`, `agents.ts`) plus all tools (read, write, edit, bash with
  git, preview, and one tool per specialized agent).

**Chat** (session): one ongoing conversation between you and the main agent. On disk it is one folder,
`~/.pi/pico/sessions/<id>/`: `meta.json` (title, working directory, model, times) and durable's storage (the transcript
and the state needed to resume work). A chat has a model, a thinking level and a working directory.

**Run**: one round of work in a chat, from your message to the agent's final answer: model turns and tool calls.

**Agent run** (child conversation): what happens when the main agent calls a specialized agent. A new conversation is
created for that one call, owned by the call, with the agent's instructions, model and tools. It starts empty except for
the task text, works on its own, and only its final answer goes back. It is stored inside the parent chat's storage and
is not shown in the app.

**Workspace**: the shared folder on the device (the app's Documents, visible in the Files app). Every chat starts there.

**Config**: `~/.pi/agent/` (pi's formats): `models.json`, `settings.json`, `AGENTS.md`, `agents/`. Shared by all chats.

## Two different things: what it sees, and what it can reach

- **Context** (what the model *sees*): the text in its prompt: the system prompt and the conversation so far. This is
  where the main agent and specialized agents differ.
- **Reach** (what it *can get to* with its tools): files, network, git. This depends only on the tools, and today the
  reach of `bash` is everything the app can access.

Isolation between chats and agents is isolation of **context**, not of **reach**.

## What a chat sees (context)

- pico's system prompt: preamble, tools, rules, the shell environment, how to build apps, how to build agents, project
  context (`AGENTS.md` / `CLAUDE.md` from the config dir and from the working directory up), and the working directory.
- Its own transcript: your messages, its answers, its tool calls and their results (after compaction: a summary of
  older parts).
- The final answers of the agents it called (not their internal steps).

It does **not** see other chats or the steps inside agent runs.

## What a chat can reach (tools)

- The whole workspace, the config, and other chats' session files (it can read and search them; see `environment`
  section), through read / write / edit / bash.
- The network: `curl` in bash, git over HTTPS; web search and pages through the `web_search` agent.
- Its preview: it shows web apps to you and gets their console errors back.
- Agents: it can call them, and create or change them by writing their files.

## What an agent sees (context)

- pico's system prompt sections (except the one about building agents), then its own instructions last.
- The task text the main agent wrote, nothing else of the chat. The main agent is told to make tasks self-contained.
- Its own tool calls and results during this one run.

It does **not** see the parent chat, other agents, or earlier runs of itself (every call starts fresh).

## What an agent can reach (tools)

- Only the tools listed in its file (none if `tools` is left out). But a listed tool has its full reach: an agent with
  `bash` can read and write everything the main agent can.
- It works in the parent chat's working directory.
- It cannot call agents.

## Open questions

1. **Is the main agent an agent?** Proposal: yes. Define it as a file too (`agents/main.md`, or `pico.md`), so a chat is
   simply "a conversation with an agent", you can change pico's behavior by editing one file, and you could start a chat
   with any agent (a chat with your `translator` agent).
2. **Should an agent's prompt include pico's built-in sections?** Today it does (coding preamble, rules, environment,
   apps). Purer: an agent gets only its own instructions plus the facts it needs (working directory, shell
   environment if it has bash).
3. **Should reach be limited, not just context?** For example an agent restricted to one folder, a read-only `bash`, or
   "ask me before push". Today the only control is which tools an agent gets.
4. **Should agent runs be visible?** Today they are hidden inside the chat. Options: show their steps in the tool card,
   open them as a read-only chat, or continue talking to one.
5. **Memory across chats.** Today chats share knowledge only through files (the workspace, `AGENTS.md`, and session files
   the agent can search). Should agents get their own memory (a notes file each), or should memory stay plain files the
   user can see and edit?
6. **Where do agents live?** Today: only the global config. Also per project (`<repo>/.pi/agents/`), shared with the repo?
