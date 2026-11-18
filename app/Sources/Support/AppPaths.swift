// Where pico keeps its data. pi's layout lives under a private HOME; the workspace is the app's Documents folder,
// which the Files app shows ("On My iPhone > pico").
import Foundation

struct AppPaths {
    /// HOME for the engine (Application Support/home): holds `.pi/agent` and `.pi/pico/sessions`.
    var home: URL
    /// pi's agent dir: models.json, settings.json, AGENTS.md, skills.
    var agentDir: URL { home.appendingPathComponent(".pi/agent") }
    var sessionsDir: URL { home.appendingPathComponent(".pi/pico/sessions") }
    /// Default working directory for new sessions.
    var workspace: URL

    static func standard() -> AppPaths {
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let documents = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return AppPaths(home: support.appendingPathComponent("home"), workspace: documents)
    }

    /// Creates the directories and installs default config files that do not exist yet.
    func prepare() throws {
        let fm = FileManager.default
        for dir in [home, agentDir, sessionsDir, workspace] {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let models = agentDir.appendingPathComponent("models.json")
        if !fm.fileExists(atPath: models.path),
           let template = Bundle.main.url(forResource: "default-models", withExtension: "json") {
            try fm.copyItem(at: template, to: models)
        }
        // Default agents, only when the folder does not exist yet: deleting an agent file is respected.
        let agents = agentDir.appendingPathComponent("agents")
        if !fm.fileExists(atPath: agents.path) {
            try fm.createDirectory(at: agents, withIntermediateDirectories: true)
            if let template = Bundle.main.url(forResource: "default-agent-web-search", withExtension: "md") {
                try fm.copyItem(at: template, to: agents.appendingPathComponent("web-search.md"))
            }
        }
        let readme = workspace.appendingPathComponent("README.md")
        if !fm.fileExists(atPath: readme.path) {
            try "# pico workspace\n\nFiles here are visible to the agent and in the Files app.\n".write(to: readme, atomically: true, encoding: .utf8)
        }
    }
}
