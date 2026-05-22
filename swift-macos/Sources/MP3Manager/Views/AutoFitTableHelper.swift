import AppKit
import SwiftUI

/// Adiciona duplo clique no cabeçalho de coluna para ajustar largura ao conteúdo visível.
struct AutoFitTableSetup: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject {
        @objc func doubleClickHeader(_ gesture: NSClickGestureRecognizer) {
            guard let header = gesture.view as? NSTableHeaderView,
                  let tv = header.tableView else { return }

            let pt = gesture.location(in: header)
            let col = header.column(at: pt)
            guard col >= 0, col < tv.tableColumns.count else { return }

            let tableCol = tv.tableColumns[col]
            var w = tableCol.headerCell.cellSize.width + 20

            let visible = tv.rows(in: tv.visibleRect)
            let start = visible.location
            let end   = start + visible.length
            for row in start..<end {
                guard let view = tv.view(atColumn: col, row: row, makeIfNecessary: false) else { continue }
                w = max(w, view.fittingSize.width + 16)
            }

            let clamped = min(max(w, tableCol.minWidth), 520)
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.15
                ctx.allowsImplicitAnimation = true
                tableCol.width = clamped
            }
        }
    }

    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let tv = Self.tableView(from: nsView),
                  let header = tv.headerView else { return }

            let alreadyInstalled = header.gestureRecognizers.contains {
                ($0 as? NSClickGestureRecognizer)?.numberOfClicksRequired == 2
            }
            guard !alreadyInstalled else { return }

            let g = NSClickGestureRecognizer(
                target: context.coordinator,
                action: #selector(Coordinator.doubleClickHeader)
            )
            g.numberOfClicksRequired = 2
            g.delaysPrimaryMouseButtonEvents = false
            header.addGestureRecognizer(g)
        }
    }

    private static func tableView(from view: NSView) -> NSTableView? {
        var v: NSView? = view
        while let current = v {
            if let sv = current as? NSScrollView,
               let tv = sv.documentView as? NSTableView { return tv }
            v = current.superview
        }
        return deepSearch(view)
    }

    private static func deepSearch(_ view: NSView) -> NSTableView? {
        if let tv = view as? NSTableView { return tv }
        for sub in view.subviews {
            if let found = deepSearch(sub) { return found }
        }
        return nil
    }
}
