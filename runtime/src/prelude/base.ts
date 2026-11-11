// Installs the globals that other prelude dependencies (readable-stream, web streams) need at load time.
// Imported first by index.ts; ES imports run in order, so these exist before later modules evaluate.
import { installConsole } from "./console.ts";
import { installEvents } from "./events.ts";
import { installText } from "./text.ts";
import { installTimers } from "./timers.ts";

installTimers();
installText();
installConsole();
installEvents();
