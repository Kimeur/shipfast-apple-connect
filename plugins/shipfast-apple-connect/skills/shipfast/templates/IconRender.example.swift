// Renders the app icon from a SwiftUI view, so the icon and the in-app mark come from the same code.
// Copy into the app's Tools/ folder, replace IconView's body with your mark, then build and run it with
// the source files the view needs:
//
//   xcrun swiftc -parse-as-library -O Tools/IconRender.swift Shared/Mark.swift -o /tmp/icon-render
//   /tmp/icon-render MyApp/Assets.xcassets/AppIcon.appiconset
//
// Writes icon-1024.png and icon-tinted-1024.png (for the tinted appearance). Check with scripts/icon-check.py.
import AppKit
import ImageIO
import SwiftUI

struct IconView: View {
    var tinted = false

    var body: some View {
        ZStack {
            if tinted {
                Color.black
            } else {
                Color(red: 0.03, green: 0.03, blue: 0.04)
            }
            // Replace with your mark. Keep it inside the middle ~80 %: the system masks the corners.
            Circle()
                .fill(tinted ? Color.white.opacity(0.85) : Color.orange)
                .frame(width: 560, height: 560)
        }
        .frame(width: 1024, height: 1024)
    }
}

@MainActor
func write(_ view: some View, to path: String) {
    let renderer = ImageRenderer(content: view)
    renderer.scale = 1
    guard let cg = renderer.cgImage else { fatalError("render failed") }
    // Flatten onto an opaque bitmap: the App Store refuses icons with an alpha channel.
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
    let flat = ctx.makeImage()!
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, flat, nil)
    CGImageDestinationFinalize(dest)
    print("wrote \(path)")
}

@main struct Main {
    static func main() {
        let out = CommandLine.arguments.dropFirst().first ?? "."
        MainActor.assumeIsolated {
            write(IconView(), to: "\(out)/icon-1024.png")
            write(IconView(tinted: true), to: "\(out)/icon-tinted-1024.png")
        }
    }
}
