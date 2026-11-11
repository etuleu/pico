// Runtime smoke test: `npm run build && pico-cli --bundle runtime/dist --script runtime/dist/smoke.js`.
// Exercises host bridges and Node shims without pi. Prints PASS/FAIL lines and exits 0 when all pass.
import * as fs from "node:fs";
import type { PicoHost } from "../src/host.ts";

const results: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);

(async () => {
	const tmp = `${process.env.TMPDIR || "/tmp"}/pico-smoke-${Date.now()}`;
	const host: PicoHost = globalThis.__pico;

	// Typed array views with a byte offset must cross the bridge as the view, not the whole buffer.
	const base = new Uint8Array([1, 2, 3, 4, 5, 6]);
	const view = base.subarray(2, 4);
	host.fs.mkdir(tmp, true);
	host.fs.writeFile(`${tmp}/view.bin`, view, false);
	const back = host.fs.readFile(`${tmp}/view.bin`);
	check("typed array byteOffset", back.length === 2 && back[0] === 3 && back[1] === 4, JSON.stringify([...back]));

	check("utf8 roundtrip", new TextDecoder().decode(new TextEncoder().encode("héllo π 😀")) === "héllo π 😀");
	const enc = new TextEncoder().encode("😀");
	const dec = new TextDecoder();
	const streamed = dec.decode(enc.subarray(0, 2), { stream: true }) + dec.decode(enc.subarray(2));
	check("utf8 streaming split", streamed === "😀", JSON.stringify(streamed));

	check("Buffer", Buffer.from("aGk=", "base64").toString() === "hi");
	check("URL", new URL("https://a.b/c?d=1").searchParams.get("d") === "1");
	check("crypto.randomUUID", /^[0-9a-f-]{36}$/.test(crypto.randomUUID()));
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")));
	check("sha256", digest[0] === 0xba && digest[31] === 0xad);
	check("structuredClone", structuredClone({ a: [{ b: 2 }] }).a[0].b === 2);

	const t0 = performance.now();
	await new Promise((r) => setTimeout(r, 50));
	const dt = performance.now() - t0;
	check("setTimeout", dt >= 45 && dt < 500, String(dt));

	const ac = new AbortController();
	let aborted = false;
	ac.signal.addEventListener("abort", () => (aborted = true));
	ac.abort();
	check("AbortController", aborted && ac.signal.reason?.name === "AbortError");

	try {
		host.fs.readFile(`${tmp}/missing`);
		check("ENOENT", false, "no throw");
	} catch (e) {
		check("ENOENT", (e as { code?: string }).code === "ENOENT", String((e as { code?: string }).code));
	}

	const res = await fetch("https://httpbin.org/anything", {
		method: "POST",
		headers: { "x-pico": "1", "content-type": "application/json" },
		body: JSON.stringify({ hi: 1 }),
	});
	const json = await res.json();
	check("fetch POST", res.status === 200 && json.json?.hi === 1 && json.headers?.["X-Pico"] === "1", res.status);

	const sse = await fetch("https://httpbin.org/stream/5");
	const reader = (sse.body as ReadableStream<Uint8Array>).getReader();
	let chunks = 0;
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks++;
		text += new TextDecoder().decode(value);
	}
	check("fetch streaming", text.trim().split("\n").length === 5, `${chunks} chunks`);

	const abortable = new AbortController();
	const pending = fetch("https://httpbin.org/delay/5", { signal: abortable.signal });
	setTimeout(() => abortable.abort(), 100);
	try {
		await pending;
		check("fetch abort", false, "resolved");
	} catch (e) {
		check("fetch abort", (e as Error).name === "AbortError", (e as Error).name);
	}

	// pi's SessionManager writes headers with repeated writeFileSync(fd, ...) on one open fd.
	{
		const fd = fs.openSync(`${tmp}/fd.txt`, "wx");
		fs.writeFileSync(fd, "a\n");
		fs.writeFileSync(fd, "b\n");
		fs.closeSync(fd);
		fs.appendFileSync(`${tmp}/fd.txt`, "c\n");
		check("writeFileSync(fd) appends", fs.readFileSync(`${tmp}/fd.txt`, "utf8") === "a\nb\nc\n");
	}

	host.fs.rm(tmp, true);
	for (const line of results) host.log("log", line);
	process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})().catch((e) => {
	globalThis.__pico.log("error", `smoke crashed: ${e}\n${e.stack}`);
	process.exit(2);
});
