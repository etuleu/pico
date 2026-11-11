// Hashing and randomness for the crypto shim.
import CryptoKit
import Foundation
import JavaScriptCore
import Security

enum HostCrypto {
    static func install(on host: JSValue) {
        Bridge.define(host, "randomBytes") { args in
            var bytes = Data(count: args.int(0))
            let count = bytes.count
            _ = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
            return Bridge.uint8Array(bytes, in: JSContext.current())
        }

        Bridge.define(host, "digest") { args in
            let data = Bridge.data(args.arg(1)) ?? Data()
            guard let digest = digest(args.string(0), data) else {
                return Bridge.throwError("Digest method not supported: \(args.string(0))", code: "ERR_CRYPTO_INVALID_DIGEST")
            }
            return Bridge.uint8Array(digest, in: JSContext.current())
        }

        Bridge.define(host, "hmac") { args in
            let key = SymmetricKey(data: Bridge.data(args.arg(1)) ?? Data())
            let data = Bridge.data(args.arg(2)) ?? Data()
            let mac: Data
            switch args.string(0) {
            case "sha1": mac = Data(HMAC<Insecure.SHA1>.authenticationCode(for: data, using: key))
            case "sha256": mac = Data(HMAC<SHA256>.authenticationCode(for: data, using: key))
            case "sha384": mac = Data(HMAC<SHA384>.authenticationCode(for: data, using: key))
            case "sha512": mac = Data(HMAC<SHA512>.authenticationCode(for: data, using: key))
            case "md5": mac = Data(HMAC<Insecure.MD5>.authenticationCode(for: data, using: key))
            default:
                return Bridge.throwError("HMAC method not supported: \(args.string(0))", code: "ERR_CRYPTO_INVALID_DIGEST")
            }
            return Bridge.uint8Array(mac, in: JSContext.current())
        }
    }

    private static func digest(_ alg: String, _ data: Data) -> Data? {
        switch alg {
        case "md5": return Data(Insecure.MD5.hash(data: data))
        case "sha1": return Data(Insecure.SHA1.hash(data: data))
        case "sha256": return Data(SHA256.hash(data: data))
        case "sha384": return Data(SHA384.hash(data: data))
        case "sha512": return Data(SHA512.hash(data: data))
        default: return nil
        }
    }
}
