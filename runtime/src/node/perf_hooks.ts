// node:perf_hooks
export const performance = globalThis.performance;
export class PerformanceObserver {
	observe(): void {}
	disconnect(): void {}
}
export function monitorEventLoopDelay() {
	return { enable() {}, disable() {}, percentile: () => 0, mean: 0, max: 0, min: 0, stddev: 0 };
}
export function createHistogram() {
	return monitorEventLoopDelay();
}
export const constants = {};

export default { performance, PerformanceObserver, monitorEventLoopDelay, createHistogram, constants };
