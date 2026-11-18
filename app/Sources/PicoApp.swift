// pico: the pi coding agent on iPhone.
import SwiftUI

@main
struct PicoApp: App {
    @State private var engine = Engine()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(engine)
                .onAppear { engine.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { engine.didEnterBackground() }
        }
    }
}
