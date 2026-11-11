// node:fs/promises
import { promises } from "./fs.ts";

export const {
	readFile,
	writeFile,
	appendFile,
	access,
	stat,
	lstat,
	readdir,
	mkdir,
	mkdtemp,
	rm,
	unlink,
	rmdir,
	rename,
	copyFile,
	cp,
	realpath,
	symlink,
	link,
	readlink,
	chmod,
	chown,
	lchown,
	utimes,
	lutimes,
	truncate,
	open,
	opendir,
	watch,
	constants,
} = promises;

export default promises;
