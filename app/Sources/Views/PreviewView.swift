// Full-screen preview of a web app the agent built: a WKWebView over the workspace files, with console capture (sent
// back to the agent) and automatic reload when the agent writes or edits files in the app's folder.
import SwiftUI
import WebKit

/// A preview the engine asked for (`requestId` set until it is answered) or the user reopened.
struct PreviewState: Identifiable, Equatable {
    var path: String
    var requestId: String?
    var id: String { path }
}

@MainActor
final class PreviewController: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    let webView: WKWebView
    private(set) var logs: [String] = []
    var onLoaded: (() -> Void)?

    private static let consoleScript = """
    (function () {
      function text(args) {
        return Array.prototype.map.call(args, function (a) {
          try {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            return JSON.stringify(a);
          } catch (e) { return String(a); }
        }).join(' ');
      }
      function send(level, args) {
        try { window.webkit.messageHandlers.pico.postMessage({ level: level, text: text(args) }); } catch (e) {}
      }
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
        var original = console[level];
        console[level] = function () { send(level, arguments); original.apply(console, arguments); };
      });
      window.addEventListener('error', function (e) {
        var where = (e.filename || '').split('/').pop();
        send('error', [(e.message || 'Error') + (where ? ' at ' + where + ':' + e.lineno + ':' + e.colno : '')]);
      });
      window.addEventListener('unhandledrejection', function (e) {
        send('error', ['Unhandled promise rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)]);
      });
    })();
    """

    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Self.consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isInspectable = true
        super.init()
        controller.add(WeakMessageHandler(self), name: "pico")
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func load(_ path: String) {
        logs = []
        let file = URL(fileURLWithPath: path)
        webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    func reload() {
        logs = []
        webView.reloadFromOrigin()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let level = body["level"] as? String ?? "log"
        let text = body["text"] as? String ?? ""
        if logs.count < 200 { logs.append("[\(level)] \(text)") }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onLoaded?()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        logs.append("[error] Load failed: \(error.localizedDescription)")
        onLoaded?()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        logs.append("[error] Load failed: \(error.localizedDescription)")
        onLoaded?()
    }

    /// Tilt and shake demos: allow DeviceOrientation / DeviceMotion without an extra prompt.
    func webView(
        _ webView: WKWebView,
        requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}

/// Breaks the retain cycle between WKUserContentController and its handler.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?

    init(_ target: any WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

private struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct PreviewScreen: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss
    let preview: PreviewState
    @State private var controller = PreviewController()
    @State private var chromeVisible = true

    private var folder: String { (preview.path as NSString).deletingLastPathComponent }

    /// Changes whenever the agent finished writing or editing a file in the app's folder.
    private var revision: String {
        guard let items = engine.view?.items else { return "" }
        let folderName = (folder as NSString).lastPathComponent
        return items.compactMap { item -> String? in
            guard case let .tool(id, _, name, args, status, _) = item, name == "write" || name == "edit", status == .done,
                  let path = args["path"]?.string else { return nil }
            let absolute = path.hasPrefix("/") ? path : (engine.workspace as NSString).appendingPathComponent(path)
            return absolute.hasPrefix(folder) || absolute.contains("/\(folderName)/") ? id : nil
        }.joined(separator: ",")
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            WebViewHost(webView: controller.webView)
                .ignoresSafeArea()
            if chromeVisible {
                HStack(spacing: 10) {
                    Button { controller.reload() } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("Reload")
                    Button { close() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial.opacity(0.9), in: Capsule())
                .environment(\.colorScheme, .dark)
                .padding(.trailing, 14)
                .padding(.top, 4)
                .transition(.opacity)
            }
        }
        .background(Color.black)
        .statusBarHidden(!chromeVisible)
        .onAppear {
            controller.onLoaded = { answerSoon() }
            controller.load(preview.path)
        }
        .onChange(of: revision) { _, _ in controller.reload() }
        .onTapGesture(count: 3) { withAnimation { chromeVisible.toggle() } }
    }

    /// Lets the page run for a moment, then reports its console output to the agent (once per request).
    private func answerSoon() {
        guard preview.requestId != nil else { return }
        Task {
            try? await Task.sleep(for: .seconds(2))
            answer()
        }
    }

    private func answer() {
        guard let requestId = preview.requestId else { return }
        engine.answerPreview(requestId: requestId, logs: controller.logs)
        engine.preview?.requestId = nil
    }

    private func close() {
        answer()
        dismiss()
    }
}
