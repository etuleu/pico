// The app's model: runs the pico engine (JS, pi-durable) in PicoRuntime and exposes its state to SwiftUI.
import Foundation
import Observation
import PicoHost
import UIKit

struct SessionViewState: Equatable {
    var sessionId: String
    var items: [Item] = []
    var live: LiveState?
    var busy = false
    var runStartedAt: Date?
    var failure: ViewEvent.Failure?
    var model: SessionInfo.ModelRef?
    var thinkingLevel: String?
    var usage: ViewEvent.Usage?
}

struct EngineError: Error, LocalizedError {
    var message: String
    var errorDescription: String? { message }
}

@MainActor
@Observable
final class Engine {
    private(set) var ready = false
    private(set) var startupError: String?
    private(set) var sessions: [SessionInfo] = []
    private(set) var models: [ModelInfo] = []
    private(set) var view: SessionViewState?
    private(set) var workspace = ""
    private(set) var logs: [String] = []
    var lastError: String?
    /// The web app preview being shown (full screen), if any.
    var preview: PreviewState?

    let paths: AppPaths
    private var runtime: PicoRuntime?
    private var buffer = ""
    private var nextId = 1
    private var pending: [String: CheckedContinuation<Data?, Error>] = [:]
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    init(paths: AppPaths = .standard()) {
        self.paths = paths
    }

    func start() {
        guard runtime == nil else { return }
        do {
            try paths.prepare()
        } catch {
            startupError = "Could not create app directories: \(error.localizedDescription)"
            return
        }
        guard let bundle = Bundle.main.url(forResource: "runtime", withExtension: nil) else {
            startupError = "The runtime is missing from the app bundle."
            return
        }

        var env = ProcessInfo.processInfo.environment
        #if DEBUG
        // Dev convenience: API keys passed at launch (simctl / devicectl environment) are saved to the Keychain.
        for (name, value) in env where name.hasSuffix("_API_KEY") && !value.isEmpty && Keychain.get(name) == nil {
            Keychain.set(value, for: name)
        }
        #endif
        for (name, value) in Keychain.allSecrets() { env[name] = value }
        env["PI_CODING_AGENT_DIR"] = paths.agentDir.path
        env["PICO_SESSIONS_DIR"] = paths.sessionsDir.path
        env["PICO_WORKSPACE"] = paths.workspace.path
        env["PICO_PLATFORM"] = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"

        let config = PicoRuntimeConfig(
            bundleDirectory: bundle,
            home: paths.home.path,
            cwd: paths.workspace.path,
            tmp: FileManager.default.temporaryDirectory.path,
            env: env,
            processBackend: NoProcessBackend(),
            scripts: [bundle.appendingPathComponent("prelude.js"), bundle.appendingPathComponent("engine.js")]
        )
        let runtime = PicoRuntime(config: config)
        runtime.onStdout = { [weak self] text in
            Task { @MainActor in self?.receive(text) }
        }
        runtime.onLog = { [weak self] level, message in
            Task { @MainActor in self?.appendLog("[\(level)] \(message)") }
        }
        runtime.onExit = { [weak self] code in
            Task { @MainActor in
                self?.startupError = "The engine stopped (exit code \(code))."
                self?.ready = false
            }
        }
        self.runtime = runtime
        runtime.start()
    }

    // MARK: - Commands

    func refreshAfterReady() async {
        do {
            let data: InitData = try await request(["type": "init"])
            workspace = data.workspace
            sessions = data.sessions
            models = data.models
            if let interrupted = data.interrupted {
                // Reopen the session whose run was cut off; pi-durable continues it.
                await openSession(interrupted)
            }
            #if DEBUG
            // Test hook: `SIMCTL_CHILD_PICO_AUTOPROMPT="..." xcrun simctl launch ...` runs one prompt in a new session.
            if let prompt = ProcessInfo.processInfo.environment["PICO_AUTOPROMPT"], !prompt.isEmpty {
                await newSession()
                await self.prompt(prompt)
            }
            #endif
        } catch {
            lastError = error.localizedDescription
        }
    }

    func newSession() async {
        do {
            let meta: SessionInfo = try await request(["type": "new_session"])
            view = SessionViewState(sessionId: meta.id)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func openSession(_ id: String) async {
        if view?.sessionId == id { return }
        view = SessionViewState(sessionId: id)
        do {
            try await send(["type": "open_session", "sessionId": id])
        } catch {
            lastError = error.localizedDescription
        }
    }

    func deleteSession(_ id: String) async {
        if view?.sessionId == id { view = nil }
        do {
            try await send(["type": "delete_session", "sessionId": id])
        } catch {
            lastError = error.localizedDescription
        }
    }

    func prompt(_ text: String) async {
        do {
            try await send(["type": "prompt", "text": text, "whenBusy": "follow_up"])
        } catch {
            lastError = error.localizedDescription
        }
    }

    func abort() async {
        do {
            try await send(["type": "abort"])
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setModel(_ model: ModelInfo) async {
        do {
            try await send(["type": "set_model", "provider": model.provider, "modelId": model.modelId])
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setThinking(_ level: String) async {
        do {
            try await send(["type": "set_thinking", "level": level])
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Stores (or removes, when empty) an API key in the Keychain and passes it to the engine.
    func setSecret(_ name: String, value: String) async {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { Keychain.delete(name) } else { Keychain.set(trimmed, for: name) }
        do {
            let models: [ModelInfo] = try await request(["type": "set_env", "name": name, "value": trimmed.isEmpty ? NSNull() : trimmed])
            self.models = models
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Preview

    /// Answers the engine's `preview` request with the page's console output and, when available, a JPEG screenshot.
    func answerPreview(requestId: String, logs: [String], screenshot: String? = nil) {
        var message: [String: Any] = ["type": "preview_result", "requestId": requestId, "shown": true, "logs": logs]
        if let screenshot { message["screenshot"] = screenshot }
        Task { try? await send(message) }
    }

    /// Reopens a preview from the transcript (no answer to the agent needed).
    func openPreview(_ path: String) {
        preview = PreviewState(path: path, requestId: nil)
    }

    // MARK: - Background execution

    /// While a run is going, ask iOS for background time so a short switch away does not interrupt it.
    /// Longer interruptions are fine: pi-durable continues the run when the session is opened again.
    func didEnterBackground() {
        guard view?.busy == true, backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "pico run") { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - Transport

    private func send(_ command: [String: Any]) async throws {
        _ = try await raw(command)
    }

    private func request<T: Decodable>(_ command: [String: Any]) async throws -> T {
        guard let data = try await raw(command) else { throw EngineError(message: "\(command["type"] ?? "command"): no data") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func raw(_ command: [String: Any]) async throws -> Data? {
        guard let runtime else { throw EngineError(message: "The engine is not running") }
        let id = String(nextId)
        nextId += 1
        var message = command
        message["id"] = id
        let line = try JSONSerialization.data(withJSONObject: message)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            runtime.sendStdin(String(decoding: line, as: UTF8.self) + "\n")
        }
    }

    private func receive(_ text: String) {
        buffer += text
        while let newline = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<newline])
            buffer = String(buffer[buffer.index(after: newline)...])
            if !line.isEmpty { handle(line) }
        }
    }

    private struct Envelope: Decodable {
        var type: String
        var id: String?
        var ok: Bool?
        var error: String?
        var message: String?
        var sessions: [SessionInfo]?
        var requestId: String?
        var path: String?
    }

    private func handle(_ line: String) {
        let data = Data(line.utf8)
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
            appendLog("[engine] unreadable: \(line.prefix(200))")
            return
        }
        switch envelope.type {
        case "ready":
            ready = true
            Task { await refreshAfterReady() }
        case "response":
            guard let id = envelope.id, let continuation = pending.removeValue(forKey: id) else { return }
            if envelope.ok == true {
                let payload = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"]
                continuation.resume(returning: payload.flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) })
            } else {
                continuation.resume(throwing: EngineError(message: envelope.error ?? "Command failed"))
            }
        case "sessions":
            sessions = envelope.sessions ?? sessions
        case "view":
            do {
                apply(try JSONDecoder().decode(ViewEvent.self, from: data))
            } catch {
                appendLog("[engine] bad view: \(error)")
            }
        case "preview":
            if let requestId = envelope.requestId, let path = envelope.path {
                if let previous = preview?.requestId { answerPreview(requestId: previous, logs: []) }
                if preview?.path == path {
                    // Already showing: the screen reloads and answers (see PreviewScreen).
                    preview?.requestId = requestId
                } else {
                    preview = PreviewState(path: path, requestId: requestId)
                }
            }
        case "error":
            lastError = envelope.message
        default:
            break
        }
    }

    private func apply(_ event: ViewEvent) {
        guard var state = view, state.sessionId == event.sessionId else { return }
        if let items = event.items { state.items = items }
        state.live = event.live
        state.busy = event.busy
        state.runStartedAt = event.runStartedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        state.failure = event.failure
        state.model = event.model ?? state.model
        state.thinkingLevel = event.thinkingLevel ?? state.thinkingLevel
        state.usage = event.usage ?? state.usage
        view = state
        if !event.busy { endBackgroundTask() }
    }

    @ObservationIgnored private lazy var logFile: FileHandle? = {
        // Library/Caches/engine.log, recreated per launch; readable with `devicectl device copy from`.
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("engine.log")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        return try? FileHandle(forWritingTo: url)
    }()

    private func appendLog(_ line: String) {
        logs.append(line)
        if logs.count > 500 { logs.removeFirst(logs.count - 500) }
        logFile?.write(Data("\(Date().formatted(.iso8601)) \(line)\n".utf8))
        #if DEBUG
        print(line)
        #endif
    }
}
