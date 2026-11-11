// node:path (POSIX). path-browserify provides the implementation; win32 is aliased since the host is POSIX.
import pathBrowserify from "path-browserify";

type PathModule = typeof pathBrowserify & { win32: PathModule; posix: PathModule; toNamespacedPath: (p: string) => string };

const base = pathBrowserify as PathModule;
export const posix: PathModule = Object.assign({}, base, {
	toNamespacedPath: (p: string) => p,
}) as PathModule;
posix.posix = posix;
posix.win32 = posix;

export const { sep, delimiter, resolve, normalize, isAbsolute, join, relative, dirname, basename, extname, format, parse } =
	posix;
export const toNamespacedPath = posix.toNamespacedPath;
export const win32 = posix;

export default posix;
