// node:stream/promises
import { shared } from "../shared.ts";

export const { pipeline, finished } = shared.stream.promises;

export default shared.stream.promises;
