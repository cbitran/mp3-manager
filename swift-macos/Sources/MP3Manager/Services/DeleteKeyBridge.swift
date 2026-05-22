import AppKit
import Combine

/// Captura a tecla Delete no nível da janela e publica um sinal via Combine.
/// Ignorado quando o foco está em um campo de texto.
final class DeleteKeyBridge: ObservableObject {
    let triggered = PassthroughSubject<Void, Never>()
    private var monitor: Any?

    func start() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // keyCode 51 = Delete (⌫)  |  117 = Forward Delete (⌦)
            guard event.keyCode == 51 || event.keyCode == 117 else { return event }
            // Não intercepta quando o usuário está digitando em um campo de texto
            if NSApp.keyWindow?.firstResponder is NSTextView { return event }
            self?.triggered.send()
            return nil
        }
    }

    func stop() {
        if let m = monitor { NSEvent.removeMonitor(m) }
        monitor = nil
    }
}
