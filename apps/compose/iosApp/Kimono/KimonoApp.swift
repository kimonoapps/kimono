import Shared
import SwiftUI

/// The iPhone shell: the shared Compose app full screen, with the Swift host behind it.
@main
struct KimonoApp: App {
    init() { Host.shared.launched() }

    var body: some Scene {
        WindowGroup {
            ComposeView().ignoresSafeArea()
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainKt.MainViewController(host: Host.shared)
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}
