# Principles

How we build pico. When a decision is unclear, come back here.

1. **Use files, like Linux.** State lives in plain files and directories a person can open, read, copy, back up,
   and edit: sessions as JSONL, config as JSON and Markdown, the workspace as a normal folder. No databases until
   files clearly fail us.
2. **Keep it simple.** Fewer moving parts, fewer layers, fewer formats. Prefer the boring solution that is easy to
   understand over the clever one.
3. **Do what's best for the user.** Not what's easiest for us, not what looks impressive. The user's time, data,
   money, and attention come first.
4. **Avoid concentration of power.** No required accounts, servers, or middlemen. pico runs on the user's device
   with the user's keys and the providers they choose. Anything remote (like a sandbox) is optional and replaceable.
5. **Empower users.** Give people real capability over their own device and data: a real agent, real files, real
   tools, nothing hidden behind us.
6. **Knowledge is at the edges.** The people using pico know what they need. Make it easy for them to teach it
   (AGENTS.md, skills, prompts) rather than deciding everything centrally.
7. **Help users understand the system.** Show what the agent does (tool calls, files, logs, costs). Use formats and
   locations people can inspect. No magic.
8. **Allow creators to modify and share.** Config, skills, prompts, and extensions are files in open formats
   (compatible with pi) that people can change, copy, and pass on.
