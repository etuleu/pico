// Host file system for the `fs` shim. POSIX calls so errors map 1:1 to Node error codes.
import Darwin
import Foundation
import JavaScriptCore

enum HostFS {
    static func install(on host: JSValue, context: JSContext) {
        let fs = JSValue(newObjectIn: context)!

        Bridge.define(fs, "readFile") { args in
            let path = args.string(0)
            let fd = open(path, O_RDONLY | O_CLOEXEC)
            if fd < 0 { return Bridge.throwErrno(errno, "open", path) }
            defer { close(fd) }
            var info = stat()
            if fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR {
                return Bridge.throwErrno(EISDIR, "read", path)
            }
            var data = Data(capacity: max(Int(info.st_size), 0))
            var buffer = [UInt8](repeating: 0, count: 256 * 1024)
            while true {
                let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
                if n < 0 {
                    if errno == EINTR { continue }
                    return Bridge.throwErrno(errno, "read", path)
                }
                if n == 0 { break }
                data.append(buffer, count: n)
            }
            return Bridge.uint8Array(data, in: JSContext.current())
        }

        Bridge.define(fs, "writeFile") { args in
            let path = args.string(0)
            let data = Bridge.data(args.arg(1)) ?? Data()
            let append = args.bool(2)
            let flags = O_WRONLY | O_CREAT | O_CLOEXEC | (append ? O_APPEND : O_TRUNC)
            let fd = open(path, flags, 0o644)
            if fd < 0 { return Bridge.throwErrno(errno, "open", path) }
            defer { close(fd) }
            var offset = 0
            let failure: Int32? = data.withUnsafeBytes { raw -> Int32? in
                while offset < raw.count {
                    let n = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                    if n < 0 {
                        if errno == EINTR { continue }
                        return errno
                    }
                    offset += n
                }
                return nil
            }
            if let failure { return Bridge.throwErrno(failure, "write", path) }
            return nil
        }

        Bridge.define(fs, "stat") { args in
            let path = args.string(0)
            var info = stat()
            let result = args.bool(1) ? stat(path, &info) : lstat(path, &info)
            if result != 0 { return Bridge.throwErrno(errno, args.bool(1) ? "stat" : "lstat", path) }
            return statObject(info)
        }

        Bridge.define(fs, "readdir") { args in
            let path = args.string(0)
            guard let dir = opendir(path) else { return Bridge.throwErrno(errno, "scandir", path) }
            defer { closedir(dir) }
            var entries: [[String: String]] = []
            while let entry = readdir(dir) {
                let name = withUnsafePointer(to: entry.pointee.d_name) {
                    $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) { String(cString: $0) }
                }
                if name == "." || name == ".." { continue }
                var type: String
                switch Int32(entry.pointee.d_type) {
                case DT_REG: type = "file"
                case DT_DIR: type = "dir"
                case DT_LNK: type = "symlink"
                default:
                    var info = stat()
                    type = lstat("\(path)/\(name)", &info) == 0 ? typeName(info.st_mode) : "other"
                }
                entries.append(["name": name, "type": type])
            }
            return entries
        }

        Bridge.define(fs, "mkdir") { args in
            let path = args.string(0)
            if args.bool(1) {
                do {
                    try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
                } catch {
                    var info = stat()
                    if stat(path, &info) == 0, (info.st_mode & S_IFMT) != S_IFDIR {
                        return Bridge.throwErrno(EEXIST, "mkdir", path)
                    }
                    return Bridge.throwErrno(posixCode(error) ?? EIO, "mkdir", path)
                }
                return nil
            }
            if Darwin.mkdir(path, 0o755) != 0 { return Bridge.throwErrno(errno, "mkdir", path) }
            return nil
        }

        Bridge.define(fs, "rm") { args in
            let path = args.string(0)
            var info = stat()
            if lstat(path, &info) != 0 { return Bridge.throwErrno(errno, "rm", path) }
            if (info.st_mode & S_IFMT) == S_IFDIR {
                if args.bool(1) {
                    do { try FileManager.default.removeItem(atPath: path) } catch {
                        return Bridge.throwErrno(posixCode(error) ?? EIO, "rm", path)
                    }
                } else if rmdir(path) != 0 {
                    return Bridge.throwErrno(errno, "rmdir", path)
                }
            } else if unlink(path) != 0 {
                return Bridge.throwErrno(errno, "unlink", path)
            }
            return nil
        }

        Bridge.define(fs, "rename") { args in
            let from = args.string(0)
            if Darwin.rename(from, args.string(1)) != 0 { return Bridge.throwErrno(errno, "rename", from) }
            return nil
        }

        Bridge.define(fs, "copyFile") { args in
            let from = args.string(0)
            if copyfile(from, args.string(1), nil, copyfile_flags_t(COPYFILE_ALL)) != 0 {
                return Bridge.throwErrno(errno, "copyfile", from)
            }
            return nil
        }

        Bridge.define(fs, "realpath") { args in
            let path = args.string(0)
            guard let resolved = Darwin.realpath(path, nil) else { return Bridge.throwErrno(errno, "realpath", path) }
            defer { free(resolved) }
            return String(cString: resolved)
        }

        Bridge.define(fs, "symlink") { args in
            let path = args.string(1)
            if Darwin.symlink(args.string(0), path) != 0 { return Bridge.throwErrno(errno, "symlink", path) }
            return nil
        }

        Bridge.define(fs, "readlink") { args in
            let path = args.string(0)
            var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) + 1)
            let n = Darwin.readlink(path, &buffer, Int(PATH_MAX))
            if n < 0 { return Bridge.throwErrno(errno, "readlink", path) }
            return String(decoding: buffer[0 ..< n].map { UInt8(bitPattern: $0) }, as: UTF8.self)
        }

        Bridge.define(fs, "chmod") { args in
            let path = args.string(0)
            if Darwin.chmod(path, mode_t(args.int(1))) != 0 { return Bridge.throwErrno(errno, "chmod", path) }
            return nil
        }

        Bridge.define(fs, "utimes") { args in
            let path = args.string(0)
            func timeval(_ ms: Double) -> Darwin.timeval {
                Darwin.timeval(tv_sec: Int(ms / 1000), tv_usec: Int32((ms.truncatingRemainder(dividingBy: 1000)) * 1000))
            }
            var times = [timeval(args.double(1)), timeval(args.double(2))]
            if Darwin.utimes(path, &times) != 0 { return Bridge.throwErrno(errno, "utime", path) }
            return nil
        }

        Bridge.define(fs, "mkdtemp") { args in
            let prefix = args.string(0)
            var template = Array("\(prefix)XXXXXX".utf8CString)
            guard Darwin.mkdtemp(&template) != nil else { return Bridge.throwErrno(errno, "mkdtemp", prefix) }
            return String(cString: template)
        }

        host.setObject(fs, forKeyedSubscript: "fs" as NSString)
    }

    private static func typeName(_ mode: mode_t) -> String {
        switch mode & S_IFMT {
        case S_IFREG: return "file"
        case S_IFDIR: return "dir"
        case S_IFLNK: return "symlink"
        default: return "other"
        }
    }

    private static func ms(_ time: timespec) -> Double {
        Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000
    }

    private static func statObject(_ info: stat) -> [String: Any] {
        [
            "type": typeName(info.st_mode),
            "size": Double(info.st_size),
            "mode": Int(info.st_mode),
            "mtimeMs": ms(info.st_mtimespec),
            "atimeMs": ms(info.st_atimespec),
            "ctimeMs": ms(info.st_ctimespec),
            "birthtimeMs": ms(info.st_birthtimespec),
            "ino": Double(info.st_ino),
            "dev": Int(info.st_dev),
            "nlink": Int(info.st_nlink),
            "uid": Int(info.st_uid),
            "gid": Int(info.st_gid),
        ]
    }

    private static func posixCode(_ error: Error) -> Int32? {
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain { return Int32(ns.code) }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain {
            return Int32(underlying.code)
        }
        if ns.domain == NSCocoaErrorDomain {
            switch ns.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return ENOENT
            case NSFileWriteFileExistsError: return EEXIST
            case NSFileWriteNoPermissionError, NSFileReadNoPermissionError: return EACCES
            default: return nil
            }
        }
        return nil
    }
}
