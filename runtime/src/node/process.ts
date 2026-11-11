// node:process: the global installed by the prelude.
const processObject = globalThis.process;

export default processObject;
export const { env, argv, platform, arch, versions, version, stdout, stderr, stdin, pid, execPath, exit, cwd, nextTick, hrtime, emitWarning } =
	processObject;
