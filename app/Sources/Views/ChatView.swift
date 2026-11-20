// One session: transcript, live answer and tools, composer, model menu.
import SwiftUI

struct ChatView: View {
    @Environment(Engine.self) private var engine
    let sessionId: String
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    private var state: SessionViewState? {
        engine.view?.sessionId == sessionId ? engine.view : nil
    }

    private var title: String {
        engine.sessions.first { $0.id == sessionId }?.title ?? "Session"
    }

    var body: some View {
        VStack(spacing: 0) {
            transcript
            Divider()
            composer
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { ModelMenu(state: state) }
        }
        .task(id: sessionId) { await engine.openSession(sessionId) }
        .fullScreenCover(item: Binding(get: { engine.preview }, set: { engine.preview = $0 })) { preview in
            PreviewScreen(preview: preview)
                .environment(engine)
        }
    }

    // MARK: Transcript

    private var displayItems: [Item] {
        guard let state else { return [] }
        let liveTools = Dictionary((state.live?.tools ?? []).compactMap { tool -> (String, Item)? in
            if case let .tool(_, callId, _, _, _, _) = tool { return (callId, tool) }
            return nil
        }, uniquingKeysWith: { a, _ in a })
        // A pending call in the transcript shows its live slot's status and output.
        return state.items.map { item in
            guard case let .tool(id, callId, name, args, status, output) = item, status == .pending,
                  case let .tool(_, _, _, _, liveStatus, liveOutput)? = liveTools[callId] else { return item }
            return .tool(id: id, callId: callId, name: name, args: args, status: liveStatus, output: liveOutput ?? output)
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(displayItems) { item in
                        ItemView(item: item)
                            .id(item.id)
                    }
                    if let live = state?.live {
                        LiveView(live: live)
                    }
                    if let failure = state?.failure {
                        FailureView(failure: failure)
                    }
                    if state?.busy == true, state?.live?.text == nil {
                        WorkingIndicator(retry: state?.live?.retry?.error)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: state?.items.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: state?.live?.text) { _, _ in
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .overlay {
                if state != nil, state?.items.isEmpty == true, state?.busy == false {
                    ContentUnavailableView(
                        "Ask pi anything",
                        systemImage: "sparkles",
                        description: Text("It can read, write and edit files in your workspace.")
                    )
                }
            }
        }
    }

    // MARK: Composer

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1 ... 8)
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                .focused($composerFocused)
                .submitLabel(.send)
            if state?.busy == true {
                Button {
                    Task { await engine.abort() }
                } label: {
                    Image(systemName: "stop.circle.fill").font(.system(size: 30))
                }
                .accessibilityLabel("Stop")
                .tint(.red)
            }
            Button {
                let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return }
                draft = ""
                Task { await engine.prompt(text) }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
            }
            .accessibilityLabel("Send")
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state == nil)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
}

/// "Working… 0:42" while a run has nothing to stream (e.g. a provider that sends a big tool call in one piece).
struct WorkingIndicator: View {
    let retry: String?
    @State private var started = Date()

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
            TimelineView(.periodic(from: started, by: 1)) { context in
                let seconds = Int(context.date.timeIntervalSince(started))
                Text(retry.map { "Retrying: \($0)" } ?? "Working… \(seconds / 60):\(String(format: "%02d", seconds % 60))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

/// Model and thinking level for the open session. Choosing a model also makes it the default for new sessions.
struct ModelMenu: View {
    @Environment(Engine.self) private var engine
    let state: SessionViewState?

    private static let thinkingLevels = ["off", "minimal", "low", "medium", "high"]

    private var current: ModelInfo? {
        guard let model = state?.model else { return nil }
        return engine.models.first { $0.provider == model.provider && $0.modelId == model.modelId }
    }

    var body: some View {
        Menu {
            Section("Model") {
                ForEach(engine.models) { model in
                    Button {
                        Task { await engine.setModel(model) }
                    } label: {
                        if model == current {
                            Label(model.name, systemImage: "checkmark")
                        } else {
                            Text("\(model.name)  ·  \(model.provider)")
                        }
                    }
                }
            }
            if current?.reasoning == true {
                Section("Thinking") {
                    ForEach(Self.thinkingLevels, id: \.self) { level in
                        Button {
                            Task { await engine.setThinking(level) }
                        } label: {
                            if level == state?.thinkingLevel { Label(level, systemImage: "checkmark") } else { Text(level) }
                        }
                    }
                }
            }
            if let usage = state?.usage, usage.input + usage.output > 0 {
                Section("Usage") {
                    Text("\(Int(usage.input)) in · \(Int(usage.output)) out" + (usage.cost > 0 ? String(format: " · $%.4f", usage.cost) : ""))
                }
            }
        } label: {
            Text(shortName)
                .font(.footnote.weight(.medium))
                .lineLimit(1)
                .frame(maxWidth: 140)
        }
    }

    private var shortName: String {
        guard let model = state?.model else { return "Model" }
        return model.modelId.split(separator: "/").last.map(String.init) ?? model.modelId
    }
}
