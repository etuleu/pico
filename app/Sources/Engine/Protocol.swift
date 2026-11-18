// Swift side of the engine protocol. Keep in sync with runtime/src/engine/protocol.ts.
import Foundation

/// Arbitrary JSON (tool arguments).
enum JSONValue: Codable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case let .object(object) = self { return object[key] }
        return nil
    }

    var string: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// Compact single-line rendering for summaries.
    var compact: String {
        guard let data = try? JSONEncoder().encode(self) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

struct SessionInfo: Codable, Identifiable, Hashable {
    struct ModelRef: Codable, Hashable {
        var provider: String
        var modelId: String
    }

    var id: String
    var title: String
    var cwd: String
    var createdAt: Double
    var updatedAt: Double
    var model: ModelRef?
    var running: Bool?
}

struct ModelInfo: Codable, Identifiable, Hashable {
    var provider: String
    var modelId: String
    var name: String
    var reasoning: Bool
    var contextWindow: Double
    var id: String { "\(provider)/\(modelId)" }
}

enum ToolStatus: String, Codable {
    case pending, running, done, error
}

enum Item: Codable, Identifiable, Hashable {
    case user(id: String, text: String)
    case assistant(id: String, text: String, thinking: String?, error: String?)
    case tool(id: String, callId: String, name: String, args: JSONValue, status: ToolStatus, output: String?)
    case notice(id: String, text: String)

    var id: String {
        switch self {
        case let .user(id, _), let .assistant(id, _, _, _), let .tool(id, _, _, _, _, _), let .notice(id, _): id
        }
    }

    private enum CodingKeys: String, CodingKey {
        case kind, id, text, thinking, error, callId, name, args, status, output
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .id)
        switch try c.decode(String.self, forKey: .kind) {
        case "user":
            self = .user(id: id, text: try c.decode(String.self, forKey: .text))
        case "assistant":
            self = .assistant(
                id: id,
                text: try c.decode(String.self, forKey: .text),
                thinking: try c.decodeIfPresent(String.self, forKey: .thinking),
                error: try c.decodeIfPresent(String.self, forKey: .error)
            )
        case "tool":
            self = .tool(
                id: id,
                callId: try c.decode(String.self, forKey: .callId),
                name: try c.decode(String.self, forKey: .name),
                args: try c.decodeIfPresent(JSONValue.self, forKey: .args) ?? .null,
                status: try c.decode(ToolStatus.self, forKey: .status),
                output: try c.decodeIfPresent(String.self, forKey: .output)
            )
        default:
            self = .notice(id: id, text: (try? c.decode(String.self, forKey: .text)) ?? "")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        switch self {
        case let .user(_, text):
            try c.encode("user", forKey: .kind)
            try c.encode(text, forKey: .text)
        case let .assistant(_, text, thinking, error):
            try c.encode("assistant", forKey: .kind)
            try c.encode(text, forKey: .text)
            try c.encodeIfPresent(thinking, forKey: .thinking)
            try c.encodeIfPresent(error, forKey: .error)
        case let .tool(_, callId, name, args, status, output):
            try c.encode("tool", forKey: .kind)
            try c.encode(callId, forKey: .callId)
            try c.encode(name, forKey: .name)
            try c.encode(args, forKey: .args)
            try c.encode(status, forKey: .status)
            try c.encodeIfPresent(output, forKey: .output)
        case let .notice(_, text):
            try c.encode("notice", forKey: .kind)
            try c.encode(text, forKey: .text)
        }
    }
}

struct LiveState: Codable, Hashable {
    struct Retry: Codable, Hashable {
        var at: Double
        var error: String
    }

    var text: String?
    var thinking: String?
    var tools: [Item]
    var retry: Retry?
}

struct ViewEvent: Codable {
    struct Failure: Codable, Hashable {
        var reason: String
        var detail: String?
    }

    struct Usage: Codable, Hashable {
        var input: Double
        var output: Double
        var cost: Double
    }

    var sessionId: String
    var busy: Bool
    var items: [Item]?
    var live: LiveState?
    var failure: Failure?
    var model: SessionInfo.ModelRef?
    var thinkingLevel: String?
    var usage: Usage?
}

struct InitData: Codable {
    var version: String
    var agentDir: String
    var workspace: String
    var sessions: [SessionInfo]
    var models: [ModelInfo]
    var interrupted: String?
}
