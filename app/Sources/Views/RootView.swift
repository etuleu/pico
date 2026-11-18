// Top level: session list and the open chat, side by side on iPad and stacked on iPhone.
import SwiftUI

struct RootView: View {
    @Environment(Engine.self) private var engine
    @State private var selection: String?
    @State private var showSettings = false
    @State private var visibility = NavigationSplitViewVisibility.automatic

    var body: some View {
        @Bindable var engine = engine
        Group {
            if let error = engine.startupError {
                ContentUnavailableView("pico could not start", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if !engine.ready {
                ProgressView("Starting pi…")
            } else {
                NavigationSplitView(columnVisibility: $visibility) {
                    SessionListView(selection: $selection, showSettings: $showSettings)
                } detail: {
                    if let selection {
                        ChatView(sessionId: selection)
                            .id(selection)
                    } else {
                        ContentUnavailableView {
                            Label("No session", systemImage: "bubble.left.and.text.bubble.right")
                        } description: {
                            Text(engine.models.isEmpty ? "Add an API key in Settings to get started." : "Start a new session.")
                        } actions: {
                            Button("New Session") { Task { await newSession() } }
                                .buttonStyle(.borderedProminent)
                            if engine.models.isEmpty {
                                Button("Settings") { showSettings = true }
                            }
                        }
                    }
                }
            }
        }
        .onChange(of: engine.view?.sessionId) { _, id in
            // Follow sessions the engine opened on its own (for example a new session).
            if let id, selection != id { selection = id }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .alert("Error", isPresented: Binding(get: { engine.lastError != nil }, set: { if !$0 { engine.lastError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(engine.lastError ?? "")
        }
    }

    private func newSession() async {
        await engine.newSession()
        selection = engine.view?.sessionId
    }
}
