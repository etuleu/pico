// pico runtime entry: runs pi's own CLI in RPC mode. stdin/stdout are bridged to the host UI.
import { configureHttpDispatcher } from "../../vendor/pi/packages/coding-agent/src/core/http-dispatcher.ts";
import { main } from "../../vendor/pi/packages/coding-agent/src/main.ts";

process.title = "pi-rpc";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";

configureHttpDispatcher();

main(["--mode", "rpc", ...process.argv.slice(2)]).catch((error: unknown) => {
	console.error("pi main failed:", error);
	process.exit(1);
});
