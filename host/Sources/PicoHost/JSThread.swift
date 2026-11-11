// The single thread that owns the JSContext. All JS calls and host callbacks run here.
import Foundation

final class JSThread: Thread {
    private var runLoop: CFRunLoop?
    private let started = DispatchSemaphore(value: 0)

    override init() {
        super.init()
        name = "pico.js"
        stackSize = 16 * 1024 * 1024
        qualityOfService = .userInitiated
    }

    func startAndWait() {
        start()
        started.wait()
    }

    override func main() {
        runLoop = CFRunLoopGetCurrent()
        // A port keeps the run loop alive when there are no timers or sources yet.
        RunLoop.current.add(NSMachPort(), forMode: .default)
        started.signal()
        while !isCancelled {
            autoreleasepool {
                _ = RunLoop.current.run(mode: .default, before: .distantFuture)
            }
        }
    }

    /// Schedules a block on the JS thread. Safe to call from any thread.
    func perform(_ block: @escaping () -> Void) {
        guard let runLoop else { return }
        CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, block)
        CFRunLoopWakeUp(runLoop)
    }

    func stop() {
        cancel()
        if let runLoop { CFRunLoopStop(runLoop) }
    }
}
