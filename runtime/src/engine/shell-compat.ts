// Compatibility rewrites for commands models commonly write but just-bash does not accept, applied to the parsed
// script before it runs. Keep each rule small and explain why it is safe.
import type { ScriptNode, SimpleCommandNode, TransformPlugin, WordNode } from "just-bash";

/** A word that is a single plain literal (no quotes, expansions or globs), e.g. `-RIl`. */
function literal(word: WordNode): string | undefined {
	const [part, ...rest] = word.parts;
	return rest.length === 0 && part?.type === "Literal" ? part.value : undefined;
}

/**
 * grep -I ("skip binary files") is not supported by just-bash's grep, which then fails the whole command with
 * "invalid option -- 'I'". Models use it constantly (`grep -RIn`). Dropping it is safe: just-bash has no binary-file
 * special case to turn off. Same for `--binary-files=without-match`.
 */
function fixGrep(command: SimpleCommandNode): void {
	const name = command.name ? literal(command.name) : undefined;
	if (name !== "grep" && name !== "egrep" && name !== "fgrep") return;
	const args: WordNode[] = [];
	let options = true;
	for (const word of command.args) {
		const value = literal(word);
		if (!options || value === undefined || !value.startsWith("-") || value === "-") {
			args.push(word);
			continue;
		}
		if (value === "--") {
			options = false;
			args.push(word);
			continue;
		}
		if (value === "--binary-files=without-match") continue;
		if (value.startsWith("--")) {
			args.push(word);
			continue;
		}
		// Short flags: `-RIl` -> `-Rl`. Stop at a flag that takes a value (`-e`, `-f`, `-m`, ...): the rest is its value.
		let rewritten = "-";
		for (let i = 1; i < value.length; i++) {
			const flag = value[i];
			if ("efmABCd".includes(flag)) {
				rewritten += value.slice(i);
				break;
			}
			if (flag !== "I") rewritten += flag;
		}
		if (rewritten !== "-") args.push({ ...word, parts: [{ ...word.parts[0], value: rewritten }] } as WordNode);
	}
	command.args = args;
}

function visit(node: unknown): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) visit(child);
		return;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "SimpleCommand") fixGrep(record as unknown as SimpleCommandNode);
	for (const value of Object.values(record)) visit(value);
}

export const compatPlugin: TransformPlugin = {
	name: "pico-compat",
	transform({ ast }: { ast: ScriptNode }) {
		visit(ast);
		return { ast };
	},
};
