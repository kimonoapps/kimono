import Shared
import SwiftUI

/// The iPhone shell: the shared Compose app full screen, with the Swift host behind it.
@main
struct KimonoApp: App {
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
