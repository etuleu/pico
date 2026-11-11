// Helpers for moving bytes and errors between Swift and JavaScriptCore.
import Foundation
import JavaScriptCore

enum Bridge {
    /// Creates a Uint8Array that owns a copy of `data`.
    static func uint8Array(_ data: Data, in context: JSContext) -> JSValue {
        let count = data.count
        let pointer = UnsafeMutableRawPointer.allocate(byteCount: max(count, 1), alignment: 1)
        data.withUnsafeBytes { raw in
            if let base = raw.baseAddress, count > 0 { pointer.copyMemory(from: base, byteCount: count) }
        }
        var exception: JSValueRef?
        let object = JSObjectMakeTypedArrayWithBytesNoCopy(
            context.jsGlobalContextRef,
            kJSTypedArrayTypeUint8Array,
            pointer,
            count,
            { bytes, _ in bytes?.deallocate() },
            nil,
            &exception
        )
        return JSValue(jsValueRef: object, in: context)
    }

    /// Copies the bytes of a typed array, DataView or ArrayBuffer. Returns nil for other values.
    static func data(_ value: JSValue?) -> Data? {
        guard let value, value.isObject, let context = value.context else { return nil }
        let ctx = context.jsGlobalContextRef
        var exception: JSValueRef?
        guard let object = JSValueToObject(ctx, value.jsValueRef, &exception) else { return nil }
        let type = JSValueGetTypedArrayType(ctx, value.jsValueRef, &exception)
        switch type {
        case kJSTypedArrayTypeNone:
            return nil
        case kJSTypedArrayTypeArrayBuffer:
            let length = JSObjectGetArrayBufferByteLength(ctx, object, &exception)
            guard length > 0, let pointer = JSObjectGetArrayBufferBytesPtr(ctx, object, &exception) else { return Data() }
            return Data(bytes: pointer, count: length)
        default:
            let length = JSObjectGetTypedArrayByteLength(ctx, object, &exception)
            guard length > 0, let pointer = JSObjectGetTypedArrayBytesPtr(ctx, object, &exception) else { return Data() }
            let offset = JSObjectGetTypedArrayByteOffset(ctx, object, &exception)
            return Data(bytes: pointer.advanced(by: offset), count: length)
        }
    }

    /// Throws a JS Error with a Node-style `code` from inside a host function.
    static func throwError(_ message: String, code: String? = nil) -> JSValue {
        let context = JSContext.current()!
        let error = JSValue(newErrorFromMessage: message, in: context)!
        if let code { error.setValue(code, forProperty: "code") }
        context.exception = error
        return JSValue(undefinedIn: context)
    }

    static func errnoName(_ code: Int32) -> String {
        switch code {
        case ENOENT: return "ENOENT"
        case EEXIST: return "EEXIST"
        case ENOTDIR: return "ENOTDIR"
        case EISDIR: return "EISDIR"
        case ENOTEMPTY: return "ENOTEMPTY"
        case EACCES: return "EACCES"
        case EPERM: return "EPERM"
        case EBADF: return "EBADF"
        case EINVAL: return "EINVAL"
        case ELOOP: return "ELOOP"
        case ENAMETOOLONG: return "ENAMETOOLONG"
        case EXDEV: return "EXDEV"
        case EBUSY: return "EBUSY"
        case EMFILE: return "EMFILE"
        case ENOSPC: return "ENOSPC"
        case EROFS: return "EROFS"
        case EAGAIN: return "EAGAIN"
        default: return "E\(code)"
        }
    }

    static func throwErrno(_ code: Int32 = errno, _ syscall: String, _ path: String) -> JSValue {
        let message = String(cString: strerror(code))
        return throwError("\(errnoName(code)): \(message), \(syscall) '\(path)'", code: errnoName(code))
    }

    /// Registers a host function. The closure receives the JS arguments and returns a JS value.
    static func define(_ object: JSValue, _ name: String, _ body: @escaping ([JSValue]) -> Any?) {
        let block: @convention(block) () -> Any? = {
            let args = (JSContext.currentArguments() as? [JSValue]) ?? []
            return body(args)
        }
        object.setObject(block, forKeyedSubscript: name as NSString)
    }
}

extension Array where Element == JSValue {
    func arg(_ index: Int) -> JSValue? {
        index < count ? self[index] : nil
    }

    func string(_ index: Int) -> String {
        arg(index)?.toString() ?? ""
    }

    func int(_ index: Int) -> Int {
        Int(arg(index)?.toDouble() ?? 0)
    }

    func double(_ index: Int) -> Double {
        arg(index)?.toDouble() ?? 0
    }

    func bool(_ index: Int) -> Bool {
        arg(index)?.toBool() ?? false
    }

    func stringArray(_ index: Int) -> [String] {
        (arg(index)?.toArray() as? [Any])?.map { "\($0)" } ?? []
    }

    func stringMap(_ index: Int) -> [String: String] {
        guard let dict = arg(index)?.toDictionary() else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in dict { out["\(key)"] = "\(value)" }
        return out
    }

    func pairs(_ index: Int) -> [(String, String)] {
        guard let list = arg(index)?.toArray() as? [[Any]] else { return [] }
        return list.compactMap { pair in
            guard pair.count == 2 else { return nil }
            return ("\(pair[0])", "\(pair[1])")
        }
    }
}
