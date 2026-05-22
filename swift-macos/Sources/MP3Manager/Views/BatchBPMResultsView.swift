import SwiftUI

struct BatchBPMResultsView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    private var successCount: Int { state.batchBPMResults.filter { $0.success }.count }
    private var failCount: Int    { state.batchBPMResults.filter { !$0.success }.count }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "waveform.badge.checkmark")
                    .font(.system(size: 36))
                    .foregroundStyle(.purple)
                Text("Análise de BPM Concluída")
                    .font(.title2.bold())

                HStack(spacing: 24) {
                    StatPill(value: successCount, label: "Analisadas", color: .green)
                    if failCount > 0 {
                        StatPill(value: failCount, label: "Falhas", color: .red)
                    }
                    StatPill(value: state.batchBPMResults.count, label: "Total", color: .secondary)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(.quaternary)

            Divider()

            // Lista de resultados
            List(state.batchBPMResults) { entry in
                HStack(spacing: 10) {
                    Image(systemName: entry.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(entry.success ? .green : .red)
                        .font(.callout)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.filename)
                            .font(.callout)
                            .lineLimit(1)
                        if let bpm = entry.bpm {
                            Text("\(bpm) BPM")
                                .font(.caption.bold())
                                .foregroundStyle(.purple)
                        } else if let err = entry.error {
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .lineLimit(2)
                        }
                    }

                    Spacer()
                }
            }
            .listStyle(.plain)

            Divider()

            HStack {
                Spacer()
                Button("Fechar") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.escape)
            }
            .padding(16)
        }
        .frame(minWidth: 480, minHeight: 400)
    }
}

private struct StatPill: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.title3.bold())
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
