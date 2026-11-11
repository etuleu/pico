// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PicoHost",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PicoHost", targets: ["PicoHost"]),
        .executable(name: "pico-cli", targets: ["pico-cli"]),
    ],
    targets: [
        .target(name: "PicoHost"),
        .executableTarget(name: "pico-cli", dependencies: ["PicoHost"]),
    ],
    swiftLanguageModes: [.v5]
)
