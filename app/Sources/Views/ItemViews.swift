// Rendering of transcript items: user and assistant messages, tool calls, notices, live state, failures.
import SwiftUI

struct ItemView: View {
    let item: Item

    var body: some View {
        switch item {
        case let .user(_, text):
            HStack {
                Spacer(minLength: 40)
                Text(text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
            }
        case let .assistant(_, text, thinking, error):
            VStack(alignment: .leading, spacing: 6) {
                if let thinking, !thinking.isEmpty { ThinkingView(text: thinking) }
                if !text.isEmpty { MarkdownText(text: text) }
                if let error {
                    if error == "aborted" {
                        // A partial answer cut off by a stop or by the app being closed; the run may have continued.
                        Label("Interrupted", systemImage: "pause.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
        case let .tool(_, _, name, args, status, output):
            ToolCard(name: name, args: args, status: status, output: output)
        case let .notice(_, text):
            HStack {
                VStack { Divider() }
                Text(text).font(.caption).foregroundStyle(.secondary)
                VStack { Divider() }
            }
        }
    }
}

struct LiveView: View {
    let live: LiveState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let thinking = live.thinking, !thinking.isEmpty { ThinkingView(text: thinking, live: true) }
            if let text = live.text, !text.isEmpty { MarkdownText(text: text) }
            ForEach(live.writing ?? []) { item in
                if case let .tool(_, _, name, args, _, _) = item { WritingCard(name: name, args: args) }
            }
        }
    }
}

/// A tool call the model is still writing, e.g. "write apps/life/index.html · 12.4 KB".
struct WritingCard: View {
    let name: String
    let args: JSONValue

    private var detail: String {
        var parts: [String] = []
        if let path = args["path"]?.string { parts.append(path) }
        if case let .object(object) = args {
            let bytes = object.values.compactMap { value -> Double? in
                if case let .number(size)? = value["size"] { return size }
                if case let .string(text) = value { return Double(text.utf8.count) }
                return nil
            }.reduce(0, +)
            if bytes > 0 { parts.append(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)) }
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(name).font(.footnote.monospaced().weight(.semibold))
            Text(detail)
                .font(.footnote.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .contentTransition(.numericText())
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Collapsible reasoning. Expanded, it scrolls inside a fixed-height box and renders only the tail of long text:
/// reasoning can run to tens of thousands of characters and, while live, changes about ten times a second.
struct ThinkingView: View {
    let text: String
    var live = false
    @State private var expanded = false

    private static let maxShown = 6_000

    private var shown: String {
        text.count > Self.maxShown ? "…" + String(text.suffix(Self.maxShown)) : text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                    Text(live ? "Thinking…" : "Thinking")
                    if text.count > Self.maxShown {
                        Text("· \(text.count / 1000)k chars").foregroundStyle(.tertiary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                ScrollView {
                    Text(shown)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                }
                .frame(maxHeight: 220)
                .defaultScrollAnchor(live ? .bottom : .top)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

struct FailureView: View {
    let failure: ViewEvent.Failure

    private var message: String {
        switch failure.reason {
        case "aborted": "Stopped."
        case "no_model": "No model is configured. Add an API key in Settings."
        case "model_error": "The model request failed."
        case "interrupted": "The run was interrupted."
        default: "The run ended without an answer (\(failure.reason))."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(message, systemImage: failure.reason == "aborted" ? "stop.circle" : "exclamationmark.triangle")
                .font(.footnote.weight(.medium))
            if let detail = failure.detail {
                Text(detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
        .foregroundStyle(failure.reason == "aborted" ? Color.secondary : Color.red)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// A tool call: name, a one-line summary of its arguments, status, and collapsible output (or an edit's diff).
struct ToolCard: View {
    @Environment(Engine.self) private var engine
    let name: String
    let args: JSONValue
    let status: ToolStatus
    let output: String?
    @State private var expanded = false

    private var summary: String {
        switch name {
        case "bash": args["command"]?.string ?? ""
        case "read", "write", "edit": relative(args["path"]?.string ?? "")
        default: args["task"]?.string ?? args["query"]?.string ?? args["url"]?.string ?? args.compact
        }
    }

    /// Paths inside the workspace are shown relative to it.
    private func relative(_ path: String) -> String {
        let root = engine.workspace.hasSuffix("/") ? engine.workspace : engine.workspace + "/"
        guard !engine.workspace.isEmpty else { return path }
        if path.hasPrefix(root) { return String(path.dropFirst(root.count)) }
        // The simulator resolves Documents through a symlinked container path; compare by the Documents suffix.
        if let range = path.range(of: "/Documents/"), root.hasSuffix("/Documents/") { return String(path[range.upperBound...]) }
        return path
    }

    private var edits: [(old: String, new: String)] {
        guard name == "edit", case let .array(list)? = args["edits"] else { return [] }
        return list.compactMap { edit in
            guard let old = edit["oldText"]?.string, let new = edit["newText"]?.string else { return nil }
            return (old, new)
        }
    }

    /// The file a finished `preview` call showed ("Showing <path> to the user.").
    private var previewPath: String? {
        guard name == "preview", status == .done, let output,
              let match = output.firstMatch(of: /Showing (.+?) to the user\./) else { return nil }
        return String(match.1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let previewPath {
                Button {
                    engine.openPreview(previewPath)
                } label: {
                    Label("Open \((previewPath as NSString).deletingLastPathComponent.split(separator: "/").last.map(String.init) ?? "app")", systemImage: "play.rectangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .padding([.horizontal, .top], 10)
            }
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    statusIcon
                    Text(name).font(.footnote.monospaced().weight(.semibold))
                    Text(summary)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(expanded ? nil : 1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .padding(10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if name == "write", let content = args["content"]?.string {
                        CodeBlock(text: content)
                    }
                    ForEach(Array(edits.enumerated()), id: \.offset) { _, edit in
                        CodeBlock(text: edit.old, tint: .red)
                        CodeBlock(text: edit.new, tint: .green)
                    }
                    if let output, !output.isEmpty {
                        CodeBlock(text: output, tint: status == .error ? .red : nil)
                    }
                }
                .padding([.horizontal, .bottom], 10)
            }
        }
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
        .onChange(of: status) { _, new in
            // Show running output; fold it once done.
            if new == .running, name == "bash" { expanded = true }
            if new == .done { expanded = false }
        }
    }

    @ViewBuilder private var statusIcon: some View {
        switch status {
        case .pending: Image(systemName: "circle.dotted").foregroundStyle(.secondary)
        case .running: ProgressView().controlSize(.small)
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .error: Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        }
    }
}

struct CodeBlock: View {
    let text: String
    var tint: Color?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text.count > 20_000 ? String(text.suffix(20_000)) : text)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .padding(8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((tint ?? Color.primary).opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// Markdown with fenced code blocks; inline markdown inside paragraphs.
struct MarkdownText: View {
    let text: String

    private enum Block: Hashable {
        case prose(String)
        case code(String)
    }

    private var blocks: [Block] {
        var blocks: [Block] = []
        var current: [String] = []
        var inCode = false
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                let chunk = current.joined(separator: "\n")
                if inCode { blocks.append(.code(chunk)) } else if !chunk.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { blocks.append(.prose(chunk)) }
                current = []
                inCode.toggle()
            } else {
                current.append(line)
            }
        }
        let rest = current.joined(separator: "\n")
        if inCode { blocks.append(.code(rest)) } else if !rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { blocks.append(.prose(rest)) }
        return blocks
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case let .prose(prose):
                    Text(attributed(prose))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case let .code(code):
                    CodeBlock(text: code)
                }
            }
        }
    }

    private func attributed(_ prose: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: prose, options: options)) ?? AttributedString(prose)
    }
}
