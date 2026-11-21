# Demo scripts

Short demos that show what pico does on a phone. Each is one or two prompts in a new chat. Use a fast model
(DeepSeek-V4.1-Flash: about 3x faster than Inkling-2-Small for app building) and speed up the waiting parts in the edit.
Triple-tap a preview to hide its controls for a clean recording.

## 1. Hire a design critic (agents)

Shows: pico creates its own colleague, uses it, and the result visibly improves.

> Create a ruthless design-critic agent in the spirit of Dieter Rams (less but better): it reviews app code and returns
> the 5 most important fixes. Then build me a pomodoro timer app, have the critic review it, apply its feedback, and
> preview the result.

What happens: a `write` card for `agents/<critic>.md`, the app is built and previewed, a card for the new critic tool
returns a numbered critique with line numbers, pico applies the fixes and previews again.
Follow-up that shows the agent persists: *"Ask the critic about my Game of Life app."*
Time: ~3 to 4 min (DeepSeek-V4.1-Flash), ~8 min (Inkling-2-Small). For a tighter video, split it: first prompt creates
the critic and builds the app, second prompt "have the critic review it and apply the fixes".

## 2. Apps from a sentence (previews)

> Build Conway's Game of Life as a beautiful phone app in apps/life: glowing cells colored by age (cyan to violet to
> deep blue), tap or drag to draw, a minimal control bar. Then preview it.

> Build 'Meadow': a meadow under a sky that follows the real time of day, butterflies by day, fireflies at night, and an
> orange cat that follows your finger, pounces at butterflies and naps in a sunbeam. Then preview it.

> Build 'Microduck', a love letter to Hugging Face's robot duck: trick buttons (waddle, sit, crouch, roller-skate, pick
> up a sock, fall and get up), a 'policy trained' meter, and a quack when tapped. Then preview it.

Follow-ups while the preview is open reload it in place: *"make it night"*, *"add lanterns"*, *"make the cat black"*.

## 3. Research with sources (web search agent)

> What happened in tech news today? Give me 5 headlines with sources.

> What's new in the latest Xcode? Then build me a one-page cheat sheet app with the highlights.

## 4. Real work on the phone (shell and git)

> Clone https://github.com/octocat/Spoon-Knife, tell me what's in it, change the page title, and show me the diff.
