import SwiftUI

@main
struct MP3ManagerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState = AppState()
    @AppStorage("appColorScheme") private var storedScheme: String = "auto"

    private var resolvedColorScheme: ColorScheme? {
        switch storedScheme {
        case "light": return .light
        case "dark":  return .dark
        default:      return nil
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .preferredColorScheme(resolvedColorScheme)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .defaultSize(width: 1100, height: 700)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Abrir Pasta...") {
                    NotificationCenter.default.post(name: .openFolderRequest, object: nil)
                }
                .keyboardShortcut("o", modifiers: .command)
            }
        }

        MenuBarExtra("MP3 Manager", systemImage: "music.note") {
            Button("Mostrar MP3 Manager") {
                NSApp.activate(ignoringOtherApps: true)
                NSApp.windows.filter { $0.canBecomeKey && !($0 is NSPanel) }.first?.makeKeyAndOrderFront(nil)
            }
            .keyboardShortcut("m", modifiers: [.command, .shift])

            Divider()

            Button("Abrir Pasta…") {
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .openFolderRequest, object: nil)
            }

            Divider()

            Button("Sair do MP3 Manager") {
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q", modifiers: .command)
        }

        Settings {
            SettingsView()
        }
    }
}

// Mantém o app vivo quando a janela é fechada
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        return .terminateNow
    }
}

extension Notification.Name {
    static let openFolderRequest       = Notification.Name("openFolderRequest")
    static let loadFolderForNavigation = Notification.Name("loadFolderForNavigation")
}
