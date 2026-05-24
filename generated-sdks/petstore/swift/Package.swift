// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "axiomify-sdk-swift",
    products: [
        .library(name: "axiomify-sdk-swift", targets: ["axiomify-sdk-swift"]),
    ],
    targets: [
        .target(name: "axiomify-sdk-swift", path: ".")
    ]
)