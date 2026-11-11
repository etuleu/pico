// node:timers/promises
import { promises } from "./timers.ts";

export const { setTimeout, setImmediate, setInterval, scheduler } = promises;

export default promises;
