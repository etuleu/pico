// PicoRuntime: runs pi (bundled for JavaScriptCore) on a dedicated thread and bridges its stdin/stdout.
import Foundation
import JavaScriptCore

public struct PicoRuntimeConfig {
    /// Directory containing prelude.js, pi.js and pkg/ (built by runtime/build.mjs).
    public var bundleDirectory: URL
    public var home: String
    public var cwd: String
    public var tmp: String
    public var env: [String: String]
    /// Extra CLI arguments for pi (after `--mode rpc`).
    public var argv: [String]
    public var processBackend: ProcessBackend
    /// Scripts evaluated in order. Defaults to the prelude and pi.
    public var scripts: [URL]

    public init(
        bundleDirectory: URL,
        home: String,
        cwd: String,
        tmp: String,
        env: [String: String],
        argv: [String] = [],
        processBackend: ProcessBackend,
        scripts: [URL]? = nil
    ) {
        self.bundleDirectory = bundleDirectory
        self.home = home
        self.cwd = cwd
        self.tmp = tmp
        self.env = env
        self.argv = argv
        self.processBackend = processBackend
        self.scripts = scripts ?? ["prelude.js", "pi.js"].map { bundleDirectory.appendingPathComponent($0) }
    }
}

public final class PicoRuntime {
    /// Called on the JS thread with each chunk pi writes to stdout (JSONL RPC events/responses).
    public var onStdout: ((String) -> Void)?
    /// Called on the JS thread with stderr output and console logs.
    public var onLog: ((String, String) -> Void)?
    /// Called on the JS thread when pi calls process.exit.
    public var onExit: ((Int32) -> Void)?

    private let config: PicoRuntimeConfig
    private let thread = JSThread()
    private var context: JSContext!
    private var fetch: HostFetch!
    private var processes: HostProcesses!
    private var timers: [Int: Timer] = [:]
    private var nextTimerId = 1
    private let startUptime = DispatchTime.now().uptimeNanoseconds
    private var exited = false

    public init(config: PicoRuntimeConfig) {
        self.config = config
    }

    /// Starts the JS thread and evaluates the bundles. Returns immediately.
    public func start() {
        thread.startAndWait()
        thread.perform { [self] in boot() }
    }

    /// Sends text to pi's stdin (JSONL RPC commands). Safe to call from any thread.
    public func sendStdin(_ text: String) {
        thread.perform { [weak self] in
            guard let self, !exited else { return }
            context.objectForKeyedSubscript("__picoStdin")?.call(withArguments: [text])
        }
    }

    /// Runs a block on the JS thread (for tests and diagnostics).
    public func perform(_ block: @escaping (JSContext) -> Void) {
        thread.perform { [weak self] in
            guard let self else { return }
            block(context)
        }
    }

    public func stop() {
        thread.perform { [weak self] in
            guard let self else { return }
            for timer in timers.values { timer.invalidate() }
            timers.removeAll()
            exited = true
            thread.stop()
        }
    }

    private func log(_ level: String, _ message: String) {
        onLog?(level, message)
    }

    private func boot() {
        context = JSContext()
        context.name = "pi"
        context.exceptionHandler = { [weak self] _, exception in
            guard let exception else { return }
            let stack = exception.objectForKeyedSubscript("stack")?.toString() ?? ""
            self?.log("error", "Uncaught \(exception.toString() ?? "exception")\n\(stack)")
        }

        let host = JSValue(newObjectIn: context)!
        installCore(on: host)
        HostFS.install(on: host, context: context)
        HostCrypto.install(on: host)
        fetch = HostFetch(thread: thread)
        fetch.install(on: host)
        processes = HostProcesses(thread: thread, backend: config.processBackend)
        processes.install(on: host)
        context.setObject(host, forKeyedSubscript: "__pico" as NSString)

        for url in config.scripts {
            let name = url.lastPathComponent
            guard let source = try? String(contentsOf: url, encoding: .utf8) else {
                log("error", "Missing bundle: \(url.path)")
                onExit?(1)
                return
            }
            let started = DispatchTime.now().uptimeNanoseconds
            context.evaluateScript(source, withSourceURL: url)
            let ms = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
            log("debug", "evaluated \(name) in \(Int(ms)) ms")
        }
    }

    private func installCore(on host: JSValue) {
        var env = config.env
        env["HOME"] = config.home
        env["TMPDIR"] = config.tmp
        env["PI_PACKAGE_DIR"] = config.bundleDirectory.appendingPathComponent("pkg").path
        let info: [String: Any] = [
            "platform": "darwin",
            "arch": "arm64",
            "home": config.home,
            "tmp": config.tmp,
            "cwd": config.cwd,
            "hostname": "pico",
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "env": env,
            "argv": config.argv,
        ]
        host.setObject(info, forKeyedSubscript: "info" as NSString)

        Bridge.define(host, "log") { [weak self] args in
            self?.log(args.string(0), args.string(1))
            return nil
        }

        Bridge.define(host, "write") { [weak self] args in
            guard let self else { return nil }
            if args.int(0) == 1 { onStdout?(args.string(1)) } else { log("stderr", args.string(1)) }
            return nil
        }

        Bridge.define(host, "exit") { [weak self] args in
            guard let self, !exited else { return nil }
            exited = true
            let code = Int32(args.int(0))
            thread.perform { [weak self] in
                guard let self else { return }
                for timer in timers.values { timer.invalidate() }
                timers.removeAll()
                onExit?(code)
            }
            return nil
        }

        Bridge.define(host, "chdir") { args in
            let path = args.string(0)
            if !FileManager.default.changeCurrentDirectoryPath(path) {
                return Bridge.throwErrno(ENOENT, "chdir", path)
            }
            return nil
        }

        Bridge.define(host, "setTimer") { [weak self] args in
            guard let self, let callback = args.arg(1) else { return 0 }
            let id = nextTimerId
            nextTimerId += 1
            let timer = Timer(timeInterval: max(args.double(0), 0) / 1000, repeats: false) { [weak self] _ in
                guard let self, timers.removeValue(forKey: id) != nil, !exited else { return }
                callback.call(withArguments: [])
            }
            timers[id] = timer
            RunLoop.current.add(timer, forMode: .default)
            return id
        }

        Bridge.define(host, "clearTimer") { [weak self] args in
            self?.timers.removeValue(forKey: args.int(0))?.invalidate()
            return nil
        }

        Bridge.define(host, "now") { [weak self] _ in
            guard let self else { return 0 }
            return Double(DispatchTime.now().uptimeNanoseconds - startUptime) / 1_000_000
        }

        Bridge.define(host, "utf8Encode") { args in
            Bridge.uint8Array(Data(args.string(0).utf8), in: JSContext.current())
        }

        Bridge.define(host, "utf8Decode") { args in
            String(decoding: Bridge.data(args.arg(0)) ?? Data(), as: UTF8.self)
        }
    }
}
