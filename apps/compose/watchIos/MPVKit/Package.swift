// swift-tools-version:5.9
// MPVKit 1.0.0 (github.com/mpvkit/MPVKit), its LGPL build only, from local
// xcframeworks: run fetch.sh first (the Watch build does).
import PackageDescription

let package = Package(
    name: "MPVKit",
    platforms: [.iOS(.v15)],
    products: [.library(name: "MPVKit", targets: ["_MPVKit"])],
    targets: [
        .target(name: "_MPVKit", dependencies: ["Libmpv", "_FFmpeg", "Libuchardet", "Libbluray"], path: "Sources/_MPVKit",
                linkerSettings: [.linkedFramework("AVFoundation"), .linkedFramework("CoreAudio")]),
        .target(name: "_FFmpeg", dependencies: ["Libavcodec", "Libavdevice", "Libavfilter", "Libavformat", "Libavutil", "Libswresample", "Libswscale", "Libssl", "Libcrypto", "Libass", "Libfreetype", "Libfribidi", "Libharfbuzz", "MoltenVK", "Libshaderc_combined", "lcms2", "Libplacebo", "Libdovi", "Libunibreak", "gmp", "nettle", "hogweed", "gnutls", "Libdav1d", "Libuavs3d"], path: "Sources/_FFmpeg",
                linkerSettings: [
                    .linkedFramework("AudioToolbox"), .linkedFramework("CoreVideo"), .linkedFramework("CoreFoundation"),
                    .linkedFramework("CoreMedia"), .linkedFramework("Metal"), .linkedFramework("VideoToolbox"),
                    .linkedLibrary("bz2"), .linkedLibrary("iconv"), .linkedLibrary("expat"), .linkedLibrary("resolv"),
                    .linkedLibrary("xml2"), .linkedLibrary("z"), .linkedLibrary("c++"),
                ]),
        .binaryTarget(name: "Libcrypto", path: "Frameworks/Libcrypto.xcframework"),
        .binaryTarget(name: "Libssl", path: "Frameworks/Libssl.xcframework"),
        .binaryTarget(name: "gmp", path: "Frameworks/gmp.xcframework"),
        .binaryTarget(name: "nettle", path: "Frameworks/nettle.xcframework"),
        .binaryTarget(name: "hogweed", path: "Frameworks/hogweed.xcframework"),
        .binaryTarget(name: "gnutls", path: "Frameworks/gnutls.xcframework"),
        .binaryTarget(name: "Libunibreak", path: "Frameworks/Libunibreak.xcframework"),
        .binaryTarget(name: "Libfreetype", path: "Frameworks/Libfreetype.xcframework"),
        .binaryTarget(name: "Libfribidi", path: "Frameworks/Libfribidi.xcframework"),
        .binaryTarget(name: "Libharfbuzz", path: "Frameworks/Libharfbuzz.xcframework"),
        .binaryTarget(name: "Libass", path: "Frameworks/Libass.xcframework"),
        .binaryTarget(name: "Libbluray", path: "Frameworks/Libbluray.xcframework"),
        .binaryTarget(name: "Libuavs3d", path: "Frameworks/Libuavs3d.xcframework"),
        .binaryTarget(name: "Libdovi", path: "Frameworks/Libdovi.xcframework"),
        .binaryTarget(name: "MoltenVK", path: "Frameworks/MoltenVK.xcframework"),
        .binaryTarget(name: "Libshaderc_combined", path: "Frameworks/Libshaderc_combined.xcframework"),
        .binaryTarget(name: "lcms2", path: "Frameworks/lcms2.xcframework"),
        .binaryTarget(name: "Libplacebo", path: "Frameworks/Libplacebo.xcframework"),
        .binaryTarget(name: "Libdav1d", path: "Frameworks/Libdav1d.xcframework"),
        .binaryTarget(name: "Libavcodec", path: "Frameworks/Libavcodec.xcframework"),
        .binaryTarget(name: "Libavdevice", path: "Frameworks/Libavdevice.xcframework"),
        .binaryTarget(name: "Libavformat", path: "Frameworks/Libavformat.xcframework"),
        .binaryTarget(name: "Libavfilter", path: "Frameworks/Libavfilter.xcframework"),
        .binaryTarget(name: "Libavutil", path: "Frameworks/Libavutil.xcframework"),
        .binaryTarget(name: "Libswresample", path: "Frameworks/Libswresample.xcframework"),
        .binaryTarget(name: "Libswscale", path: "Frameworks/Libswscale.xcframework"),
        .binaryTarget(name: "Libuchardet", path: "Frameworks/Libuchardet.xcframework"),
        .binaryTarget(name: "Libmpv", path: "Frameworks/Libmpv.xcframework"),
    ]
)
