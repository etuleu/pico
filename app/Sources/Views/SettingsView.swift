// Settings: API keys (stored in the Keychain, passed to the engine as pi's environment variables), and where files live.
import SwiftUI

struct SettingsView: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss

    /// Providers with their pi environment variable. DeepInfra is configured in the default models.json.
    private static let providers: [(name: String, env: String)] = [
        ("DeepInfra", "DEEPINFRA_API_KEY"),
        ("Anthropic", "ANTHROPIC_API_KEY"),
        ("OpenAI", "OPENAI_API_KEY"),
        ("OpenRouter", "OPENROUTER_API_KEY"),
        ("Google Gemini", "GEMINI_API_KEY"),
        ("Groq", "GROQ_API_KEY"),
        ("xAI", "XAI_API_KEY"),
        ("Mistral", "MISTRAL_API_KEY"),
        ("DeepSeek", "DEEPSEEK_API_KEY"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Self.providers, id: \.env) { provider in
                        NavigationLink {
                            APIKeyEditor(name: provider.name, env: provider.env)
                        } label: {
                            HStack {
                                Text(provider.name)
                                Spacer()
                                Text(Keychain.get(provider.env) == nil ? "Not set" : "Set")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("API keys")
                } footer: {
                    Text("Keys are stored in the iOS Keychain and sent only to their provider.")
                }

                Section("Models") {
                    if engine.models.isEmpty {
                        Text("No models available. Add an API key.").foregroundStyle(.secondary)
                    } else {
                        Text("\(engine.models.count) models available")
                    }
                }

                Section {
                    LabeledContent("Workspace", value: "Files › On My iPhone › pico")
                    LabeledContent("Config", value: "~/.pi/agent")
                } header: {
                    Text("Files")
                } footer: {
                    Text("models.json, settings.json and AGENTS.md use pi's formats.")
                }

                Section("Diagnostics") {
                    NavigationLink("Engine log") { LogView() }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

struct APIKeyEditor: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss
    let name: String
    let env: String
    @State private var value = ""

    var body: some View {
        Form {
            Section {
                SecureField("API key", text: $value)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                Text("Environment variable: \(env)")
            }
            Section {
                Button("Save") {
                    Task {
                        await engine.setSecret(env, value: value)
                        dismiss()
                    }
                }
                if Keychain.get(env) != nil {
                    Button("Remove", role: .destructive) {
                        Task {
                            await engine.setSecret(env, value: "")
                            dismiss()
                        }
                    }
                }
            }
        }
        .navigationTitle(name)
    }
}

struct LogView: View {
    @Environment(Engine.self) private var engine

    var body: some View {
        ScrollView {
            Text(engine.logs.joined(separator: "\n"))
                .font(.caption2.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle("Engine log")
    }
}
