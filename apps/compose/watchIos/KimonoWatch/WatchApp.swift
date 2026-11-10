import SwiftUI
import UIKit
import WatchShared

/// Kimono Watch on iPhone: the shared Compose app full screen, the Swift host behind it.
@main
struct KimonoWatchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            WatchView()
                .ignoresSafeArea()
                .background(Color(red: 0x11 / 255, green: 0x0C / 255, blue: 0x0A / 255))
                .preferredColorScheme(.dark)
                .onOpenURL { WatchIos.shared.open(url: $0.absoluteString) }
        }
        .onChange(of: phase) { _, now in
            switch now {
            case .active: WatchIos.shared.cameForward()
            case .background: WatchIos.shared.wentBackground()
            default: break
            }
        }
    }
}

struct WatchView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        WatchIos.shared.controller(host: Host.shared)
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Portrait to browse, landscape while the player is up.
    static var orientations: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        AppDelegate.orientations
    }

    /// iOS wakes the app when a background download finishes; the downloader calls this back once it has the file.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        Downloader.shared.finishedEvents = completionHandler
    }
}
