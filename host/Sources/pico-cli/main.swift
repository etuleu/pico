// pico-cli: runs the pico runtime on macOS with stdin/stdout wired to the terminal.
// Behaves like `pi --mode rpc`, which makes it easy to test the runtime before the iOS app.
//
// Usage: pico-cli --bundle <runtime/dist> [--cwd <dir>] [--home <dir>] [--script <file.js>] [-- <pi args>]
// --script evaluates <file.js> after the prelude instead of pi (for runtime tests).
import Foundation
import PicoHost

var arguments = Array(CommandLine.arguments.dropFirst())
var options: [String: String] = [:]
var piArgs: [String] = []
while !arguments.isEmpty {
    let arg = arguments.removeFirst()
    if arg == "--" {
        piArgs = arguments
        break
    }
    if arg.hasPrefix("--"), !arguments.isEmpty {
        options[String(arg.dropFirst(2))] = arguments.removeFirst()
    }
}

guard let bundle = options["bundle"] else {
    FileHandle.standardError.write("usage: pico-cli --bundle <runtime/dist> [--cwd <dir>] [--home <dir>] [-- <pi args>]\n".data(using: .utf8)!)
    exit(2)
}

let verbose = ProcessInfo.processInfo.environment["PICO_VERBOSE"] == "1"
let cwd = URL(fileURLWithPath: options["cwd"] ?? ".", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).path
let config = PicoRuntimeConfig(
    bundleDirectory: URL(fileURLWithPath: bundle),
    home: options["home"] ?? NSHomeDirectory(),
    cwd: (cwd as NSString).standardizingPath,
    tmp: NSTemporaryDirectory().hasSuffix("/") ? String(NSTemporaryDirectory().dropLast()) : NSTemporaryDirectory(),
    env: ProcessInfo.processInfo.environment,
    argv: piArgs,
    processBackend: FoundationProcessBackend(),
    scripts: options["script"].map { [URL(fileURLWithPath: bundle).appendingPathComponent("prelude.js"), URL(fileURLWithPath: $0)] }
)
FileManager.default.changeCurrentDirectoryPath(config.cwd)

let runtime = PicoRuntime(config: config)
let stdout = FileHandle.standardOutput
let stderr = FileHandle.standardError

runtime.onStdout = { text in
    stdout.write(Data(text.utf8))
}
runtime.onLog = { level, message in
    if level == "debug", !verbose { return }
    let prefix = level == "stderr" ? "" : "[\(level)] "
    stderr.write(Data("\(prefix)\(message)\(message.hasSuffix("\n") ? "" : "\n")".utf8))
}
runtime.onExit = { code in
    exit(code)
}
runtime.start()

// Forward stdin; on EOF, close pi's stdin (RPC mode then shuts down).
DispatchQueue.global().async {
    let input = FileHandle.standardInput
    while true {
        let data = input.availableData
        if data.isEmpty {
            runtime.perform { context in
                context.objectForKeyedSubscript("__picoStdin")?.call(withArguments: [NSNull()])
            }
            return
        }
        runtime.sendStdin(String(decoding: data, as: UTF8.self))
    }
}

dispatchMain()
