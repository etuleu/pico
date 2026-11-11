// macOS process backend on Foundation.Process. Used by the dev CLI host; iOS has no fork/exec.
#if os(macOS)
import Foundation

public final class FoundationProcessBackend: ProcessBackend {
    public init() {}

    private func resolve(_ command: String, env: [String: String]) -> String? {
        if command.contains("/") { return command }
        let path = env["PATH"] ?? ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"
        for dir in path.split(separator: ":") {
            let candidate = "\(dir)/\(command)"
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }

    private func makeProcess(command: String, args: [String], cwd: String, env: [String: String]) throws -> Process {
        guard let executable = resolve(command, env: env) else {
            throw ProcessError(code: "ENOENT", message: "spawn \(command) ENOENT")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        process.environment = env
        return process
    }

    public func spawn(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        onStdout: @escaping (Data) -> Void,
        onStderr: @escaping (Data) -> Void,
        onExit: @escaping (Int32?, String?) -> Void
    ) throws -> SpawnedProcess {
        let process = try makeProcess(command: command, args: args, cwd: cwd, env: env)
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        // Report exit only after both pipes reach EOF, so no output arrives after "exit".
        let lock = NSLock()
        var openPipes = 2
        var exitStatus: (Int32?, String?)?
        let finishIfDone = {
            lock.lock()
            let ready = openPipes == 0 ? exitStatus : nil
            if ready != nil { exitStatus = nil }
            lock.unlock()
            if let ready { onExit(ready.0, ready.1) }
        }
        let pipeClosed = {
            lock.lock()
            openPipes -= 1
            lock.unlock()
            finishIfDone()
        }
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                pipeClosed()
            } else {
                onStdout(data)
            }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                pipeClosed()
            } else {
                onStderr(data)
            }
        }
        process.terminationHandler = { process in
            lock.lock()
            if process.terminationReason == .uncaughtSignal {
                exitStatus = (nil, signalName(process.terminationStatus))
            } else {
                exitStatus = (process.terminationStatus, nil)
            }
            lock.unlock()
            finishIfDone()
        }
        do {
            try process.run()
        } catch {
            throw ProcessError(code: "ENOENT", message: "spawn \(command): \(error.localizedDescription)")
        }
        return FoundationSpawnedProcess(process: process, stdin: stdin)
    }

    public func run(
        command: String,
        args: [String],
        cwd: String,
        env: [String: String],
        input: Data?,
        timeout: TimeInterval
    ) throws -> ProcessResult {
        let process = try makeProcess(command: command, args: args, cwd: cwd, env: env)
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()

        var out = Data()
        var err = Data()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            out = stdout.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }
        group.enter()
        DispatchQueue.global().async {
            err = stderr.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }
        if let input { stdin.fileHandleForWriting.write(input) }
        try? stdin.fileHandleForWriting.close()

        if timeout > 0 {
            let deadline = DispatchTime.now() + timeout
            if group.wait(timeout: deadline) == .timedOut { process.terminate() }
        }
        group.wait()
        process.waitUntilExit()
        if process.terminationReason == .uncaughtSignal {
            return ProcessResult(status: nil, signal: signalName(process.terminationStatus), stdout: out, stderr: err)
        }
        return ProcessResult(status: process.terminationStatus, signal: nil, stdout: out, stderr: err)
    }
}

private final class FoundationSpawnedProcess: SpawnedProcess {
    let process: Process
    let stdin: Pipe

    init(process: Process, stdin: Pipe) {
        self.process = process
        self.stdin = stdin
    }

    var pid: Int32 { process.processIdentifier }

    func write(_ data: Data?) {
        if let data {
            stdin.fileHandleForWriting.write(data)
        } else {
            try? stdin.fileHandleForWriting.close()
        }
    }

    func kill(signal: Int32) {
        Darwin.kill(process.processIdentifier, signal)
    }
}
#endif
