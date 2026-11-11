// Streaming HTTP for the fetch polyfill, on URLSession. Callbacks hop to the JS thread.
import Foundation
import JavaScriptCore

final class HostFetch: NSObject, URLSessionDataDelegate {
    private struct Pending {
        let onResponse: JSValue
        let onData: JSValue
        let onEnd: JSValue
    }

    private let thread: JSThread
    private var session: URLSession!
    /// Accessed only on the JS thread.
    private var pending: [Int: Pending] = [:]
    /// Accessed only on the JS thread.
    private var tasks: [Int: URLSessionDataTask] = [:]
    private var nextId = 1

    init(thread: JSThread) {
        self.thread = thread
        super.init()
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 24 * 3600
        config.httpCookieStorage = nil
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }

    func install(on host: JSValue) {
        Bridge.define(host, "fetch") { [unowned self] args in
            guard let url = URL(string: args.string(0)) else {
                return Bridge.throwError("Invalid URL: \(args.string(0))", code: "ERR_INVALID_URL")
            }
            var request = URLRequest(url: url)
            request.httpMethod = args.string(1)
            for (key, value) in args.pairs(2) {
                request.addValue(value, forHTTPHeaderField: key)
            }
            if let body = Bridge.data(args.arg(3)) { request.httpBody = body }
            guard let onResponse = args.arg(4), let onData = args.arg(5), let onEnd = args.arg(6) else {
                return Bridge.throwError("fetch: missing callbacks")
            }
            let id = nextId
            nextId += 1
            let task = session.dataTask(with: request)
            task.taskDescription = String(id)
            pending[id] = Pending(onResponse: onResponse, onData: onData, onEnd: onEnd)
            tasks[id] = task
            task.resume()
            return id
        }

        Bridge.define(host, "fetchAbort") { [unowned self] args in
            let id = args.int(0)
            tasks.removeValue(forKey: id)?.cancel()
            pending.removeValue(forKey: id)
            return nil
        }
    }

    private func id(of task: URLSessionTask) -> Int {
        Int(task.taskDescription ?? "") ?? 0
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let id = id(of: dataTask)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 200
        var headers: [[String]] = []
        for (key, value) in http?.allHeaderFields ?? [:] {
            headers.append(["\(key)".lowercased(), "\(value)"])
        }
        let head: [String: Any] = [
            "status": status,
            "statusText": HTTPURLResponse.localizedString(forStatusCode: status),
            "url": response.url?.absoluteString ?? "",
            "headers": headers,
        ]
        thread.perform { [weak self] in
            self?.pending[id]?.onResponse.call(withArguments: [head])
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let id = id(of: dataTask)
        thread.perform { [weak self] in
            guard let entry = self?.pending[id], let context = entry.onData.context else { return }
            entry.onData.call(withArguments: [Bridge.uint8Array(data, in: context)])
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = id(of: task)
        let message: Any = error.map { ($0 as NSError).localizedDescription } ?? NSNull()
        thread.perform { [weak self] in
            guard let self, let entry = pending.removeValue(forKey: id) else { return }
            tasks.removeValue(forKey: id)
            entry.onEnd.call(withArguments: [message])
        }
    }
}
