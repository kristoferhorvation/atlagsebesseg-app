// swift-tools-version: 6.0
import PackageDescription

// A packages/core (TypeScript) 1:1 Swift-portja (A9). Függőségmentes, mint a TS core.
let package = Package(
    name: "AtlagsebessegCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AtlagsebessegCore", targets: ["AtlagsebessegCore"]),
        // Csak teszteknek: a közös fixtúrák (packages/core/fixtures) betöltője.
        .library(name: "AtlagsebessegTestSupport", targets: ["AtlagsebessegTestSupport"]),
    ],
    targets: [
        .target(name: "AtlagsebessegCore"),
        .target(name: "AtlagsebessegTestSupport", dependencies: ["AtlagsebessegCore"]),
        .testTarget(name: "AtlagsebessegCoreTests", dependencies: ["AtlagsebessegCore", "AtlagsebessegTestSupport"]),
    ]
)
