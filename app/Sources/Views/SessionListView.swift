// The list of sessions, newest first.
import SwiftUI

struct SessionListView: View {
    @Environment(Engine.self) private var engine
    @Binding var selection: String?
    @Binding var showSettings: Bool

    var body: some View {
        List(selection: $selection) {
            ForEach(engine.sessions) { session in
                NavigationLink(value: session.id) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.title)
                            .lineLimit(2)
                        // Static ("5 min. ago", "yesterday"); the `.relative` style ticks every second like a timer.
                        Text(Date(timeIntervalSince1970: session.updatedAt / 1000).formatted(.relative(presentation: .named, unitsStyle: .abbreviated)))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        if selection == session.id { selection = nil }
                        Task { await engine.deleteSession(session.id) }
                    }
                }
            }
        }
        .navigationTitle("pico")
        .overlay {
            if engine.sessions.isEmpty {
                ContentUnavailableView("No sessions", systemImage: "tray", description: Text("Start one with the compose button."))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task {
                        await engine.newSession()
                        selection = engine.view?.sessionId
                    }
                } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("New Session")
            }
        }
    }
}
