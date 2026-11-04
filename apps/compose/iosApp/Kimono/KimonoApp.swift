import Shared
import SwiftUI

/// The iPhone shell: the shared Compose app full screen, with the Swift host behind it.
@main
struct KimonoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    init() { Host.shared.launched() }

    var body: some Scene {
        WindowGroup {
            ComposeView().ignoresSafeArea()
        }
        .onChange(of: phase) { _, now in
            if now == .active { Host.shared.cameForward() }
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainKt.MainViewController(host: Host.shared)
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

/** iOS wakes Kimono when a background upload's piece lands; the uploader queues the next. */
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        BackgroundUploader.shared.finishedEvents = completionHandler
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundUploader.shared.resume()
        return true
    }
}
