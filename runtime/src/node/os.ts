// node:os
import { host } from "../host.ts";

const info = host.info;

export const EOL = "\n";
export const devNull = "/dev/null";
export const constants = {
	signals: { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>,
	errno: {} as Record<string, number>,
	priority: {},
};

export function homedir(): string {
	return process.env.HOME || info.home;
}

export function tmpdir(): string {
	return process.env.TMPDIR?.replace(/\/$/, "") || info.tmp;
}

export function hostname(): string {
	return info.hostname;
}

export function platform(): string {
	return info.platform;
}

export function type(): string {
	return "Darwin";
}

export function release(): string {
	return "25.0.0";
}

export function version(): string {
	return "Darwin Kernel";
}

export function machine(): string {
	return info.arch === "arm64" ? "arm64" : "x86_64";
}

export function arch(): string {
	return info.arch;
}

export function endianness(): "LE" {
	return "LE";
}

export function cpus(): { model: string; speed: number; times: Record<string, number> }[] {
	return Array.from({ length: 6 }, () => ({
		model: "Apple",
		speed: 0,
		times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
	}));
}

export function availableParallelism(): number {
	return 6;
}

export function totalmem(): number {
	return 8 * 1024 ** 3;
}

export function freemem(): number {
	return 2 * 1024 ** 3;
}

export function uptime(): number {
	return process.uptime();
}

export function loadavg(): number[] {
	return [0, 0, 0];
}

export function networkInterfaces(): Record<string, unknown[]> {
	return {};
}

export function userInfo(): { username: string; uid: number; gid: number; shell: string; homedir: string } {
	return { username: process.env.USER || "mobile", uid: 501, gid: 20, shell: "/bin/sh", homedir: homedir() };
}

export function getPriority(): number {
	return 0;
}

export function setPriority(): void {}

export default {
	EOL,
	devNull,
	constants,
	homedir,
	tmpdir,
	hostname,
	platform,
	type,
	release,
	version,
	machine,
	arch,
	endianness,
	cpus,
	availableParallelism,
	totalmem,
	freemem,
	uptime,
	loadavg,
	networkInterfaces,
	userInfo,
	getPriority,
	setPriority,
};
