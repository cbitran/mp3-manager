import SwiftUI

struct BatchResultsView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()

            if state.batchLog.isEmpty && state.reviewQueue.isEmpty {
                ContentUnavailableView(
                    "Nenhuma alteração necessária",
                    systemImage: "checkmark.seal.fill",
                    description: Text("Todas as músicas já estão com metadados corretos.")
                )
            } else {
                TabView {
                    autoFixedTab
                        .tabItem { Label("Corrigidas (\(state.batchLog.count))", systemImage: "checkmark.circle.fill") }

                    reviewQueueTab
                        .tabItem { Label("Revisão (\(state.reviewQueue.count))", systemImage: "exclamationmark.triangle.fill") }
                }
            }

            Divider()
            HStack {
                Spacer()
                Button("Fechar") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return)
            }
            .padding(16)
        }
        .frame(minWidth: 620, idealWidth: 700, minHeight: 580, idealHeight: 650)
    }

    private var header: some View {
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Resultado do Batch Fix", systemImage: "wand.and.stars")
                    .font(.title3.bold())
                Text("Processamento concluído")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 16) {
                ResultBadge(value: state.batchLog.count, label: "auto-corrigidas", color: .green)
                ResultBadge(value: state.reviewQueue.count, label: "em revisão", color: .orange)
            }
        }
        .padding(16)
    }

    private var autoFixedTab: some View {
        List(state.batchLog) { entry in
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Label(entry.filename, systemImage: "music.note")
                        .font(.callout.bold())
                    Spacer()
                    Text(entry.source.rawValue)
                        .font(.caption)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.green.opacity(0.2))
                        .cornerRadius(4)
                }
                ForEach(entry.changes, id: \.field) { change in
                    HStack(spacing: 4) {
                        Text(change.field + ":")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(change.from.isEmpty ? "(vazio)" : change.from)
                            .font(.caption).strikethrough().foregroundStyle(.red)
                        Image(systemName: "arrow.right")
                            .font(.caption2)
                        Text(change.to)
                            .font(.caption).foregroundStyle(.green)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var reviewQueueTab: some View {
        Group {
            if state.reviewQueue.isEmpty {
                ContentUnavailableView("Sem itens para revisar", systemImage: "checkmark.circle")
            } else {
                ReviewQueueView()
            }
        }
    }
}

struct ResultBadge: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title2.bold()).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
