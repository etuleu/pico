// Child processes for the child_process shim. The backend is pluggable: Foundation.Process on macOS,
// ios_system (in-process commands) or a remote sandbox on iOS.
import Foundation
import JavaScriptCore

public protocol SpawnedProcess: AnyObject {
    var pid: Int32 { get }
    /// Writes to stdin; nil closes stdin.
    func write(_ data: Data?)
    func kill(signal: Int32)
}

public struct ProcessResult {
    public var status: Int32?
    public var signal: String?
    public var stdout: Data
    public var stderr: Data

    public init(status: Int32?, signal: String?, stdout: Data, stderr: Data) {
        self.status = status
        self.signal = signal
        self.stdout = stdout
        self.stderr = stderr
    }
}

public struct ProcessError: Error {
    public var code: String
    public var message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// Callbacks may be invoked from any thread; the host hops them onto the JS thread.
public protocol ProcessBackend: AnyObject {
    func spawn(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        onStdout: @escaping (Data) -> Void,
        onStderr: @escaping (Data) -> Void,
        onExit: @escaping (Int32?, String?) -> Void
    ) throws -> SpawnedProcess

    func run(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        input: Data?,
        timeout: TimeInterval
    ) throws -> ProcessResult
}

/// A backend for platforms without process support.
public final class NoProcessBackend: ProcessBackend {
    public init() {}

    public func spawn(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        onStdout: @escaping (Data) -> Void,
        onStderr: @escaping (Data) -> Void,
        onExit: @escaping (Int32?, String?) -> Void
    ) throws -> SpawnedProcess {
        throw ProcessError(code: "ENOSYS", message: "spawn \(command): processes are not supported on this platform")
    }

    public func run(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        input: Data?,
        timeout: TimeInterval
    ) throws -> ProcessResult {
        throw ProcessError(code: "ENOSYS", message: "spawnSync \(command): processes are not supported on this platform")
    }
}

let signalNumbers: [String: Int32] = ["SIGHUP": 1, "SIGINT": 2, "SIGQUIT": 3, "SIGKILL": 9, "SIGTERM": 15, "SIGSTOP": 17, "SIGCONT": 19]

func signalName(_ number: Int32) -> String {
    signalNumbers.first { $0.value == number }?.key ?? "SIG\(number)"
}

final class HostProcesses {
    private let thread: JSThread
    private let backend: ProcessBackend
    /// Accessed only on the JS thread.
    private var processes: [Int: SpawnedProcess] = [:]
    private var nextId = 1

    init(thread: JSThread, backend: ProcessBackend) {
        self.thread = thread
        self.backend = backend
    }

    func install(on host: JSValue) {
        Bridge.define(host, "spawn") { [unowned self] args in
            guard let onStdout = args.arg(4), let onStderr = args.arg(5), let onExit = args.arg(6) else {
                return Bridge.throwError("spawn: missing callbacks")
            }
            let id = nextId
            nextId += 1
            let thread = thread
            let deliver: (JSValue) -> (Data) -> Void = { callback in
                { data in
                    thread.perform {
                        guard let context = callback.context else { return }
                        callback.call(withArguments: [Bridge.uint8Array(data, in: context)])
                    }
                }
            }
            do {
                let process = try backend.spawn(
                    command: args.string(0),
                    args: args.stringArray(1),
                    cwd: args.string(2),
                    env: args.stringMap(3),
                    onStdout: deliver(onStdout),
                    onStderr: deliver(onStderr),
                    onExit: { [weak self] code, signal in
                        thread.perform {
                            self?.processes.removeValue(forKey: id)
                            onExit.call(withArguments: [code.map { NSNumber(value: $0) } ?? NSNull(), signal ?? NSNull()])
                        }
                    }
                )
                processes[id] = process
                return Int(process.pid)
            } catch let error as ProcessError {
                return Bridge.throwError(error.message, code: error.code)
            } catch {
                return Bridge.throwError("spawn \(args.string(0)): \(error.localizedDescription)", code: "ENOENT")
            }
        }

        Bridge.define(host, "spawnWrite") { [unowned self] args in
            process(pid: args.int(0))?.write(args.arg(1).flatMap { $0.isNull ? nil : Bridge.data($0) })
            return nil
        }

        Bridge.define(host, "spawnKill") { [unowned self] args in
            process(pid: args.int(0))?.kill(signal: signalNumbers[args.string(1)] ?? SIGTERM)
            return nil
        }

        Bridge.define(host, "kill") { [unowned self] args in
            let pid = args.int(0)
            let signal = signalNumbers[args.string(1)] ?? SIGTERM
            if let process = process(pid: abs(pid)) {
                process.kill(signal: signal)
                return true
            }
            return Bridge.throwError("kill ESRCH", code: "ESRCH")
        }

        Bridge.define(host, "spawnSync") { [unowned self] args in
            do {
                let input = args.arg(4).flatMap { $0.isNull ? nil : Bridge.data($0) }
                let result = try backend.run(
                    command: args.string(0),
                    args: args.stringArray(1),
                    cwd: args.string(2),
                    env: args.stringMap(3),
                    input: input,
                    timeout: args.double(5) / 1000
                )
                let context = JSContext.current()!
                let out = JSValue(newObjectIn: context)!
                out.setValue(result.status.map { NSNumber(value: $0) } ?? NSNull(), forProperty: "status")
                out.setValue(result.signal ?? NSNull(), forProperty: "signal")
                out.setValue(Bridge.uint8Array(result.stdout, in: context), forProperty: "stdout")
                out.setValue(Bridge.uint8Array(result.stderr, in: context), forProperty: "stderr")
                return out
            } catch let error as ProcessError {
                return Bridge.throwError(error.message, code: error.code)
            } catch {
                return Bridge.throwError("spawnSync \(args.string(0)): \(error.localizedDescription)", code: "ENOENT")
            }
        }
    }

    private func process(pid: Int) -> SpawnedProcess? {
        processes.values.first { Int($0.pid) == pid }
    }
}
