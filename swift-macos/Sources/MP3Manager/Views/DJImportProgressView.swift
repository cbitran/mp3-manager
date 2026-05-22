import SwiftUI

// Aparece durante o processo de importação em lote
struct DJImportProgressSheet: View {
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)
                .symbolEffect(.pulse)

            Text("Importando dados DJ…")
                .font(.title3.bold())

            VStack(spacing: 6) {
                ProgressView(value: state.djImportProgress)
                    .progressViewStyle(.linear)
                    .frame(width: 320)

                HStack {
                    Text(state.djImportCurrent)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text("\(state.djImportDone) / \(state.djImportTotal)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .frame(width: 320)
            }
        }
        .padding(32)
        .frame(width: 400)
    }
}

// Aparece ao finalizar a importação
struct DJImportResultsSheet: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            resultsHeader
            Divider()
            resultsList
            Divider()
            footer
        }
        .frame(width: 400)
    }

    private var resultsHeader: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.green.opacity(0.15)).frame(width: 44, height: 44)
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3).foregroundStyle(.green)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Importação Concluída")
                    .font(.title3.bold())
                if let s = state.djImportResults {
                    Text(String(format: "%.0f%% das faixas encontradas", s.successRate * 100))
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
    }

    @ViewBuilder
    private var resultsList: some View {
        if let s = state.djImportResults {
            VStack(spacing: 0) {
                ResultRow(icon: "music.note",           color: .primary,  label: "Total processado",   value: "\(s.totalTracks)")
                Divider().padding(.leading, 44)
                ResultRow(icon: "waveform",             color: .teal,     label: "Encontrado no Serato",    value: "\(s.foundInSerato)")
                Divider().padding(.leading, 44)
                ResultRow(icon: "record.circle",        color: .red,      label: "Encontrado no Rekordbox", value: "\(s.foundInRekordbox)")
                Divider().padding(.leading, 44)
                ResultRow(icon: "flag.fill",            color: .orange,   label: "Com cue points",     value: "\(s.withCuePoints)")
                Divider().padding(.leading, 44)
                ResultRow(icon: "metronome.fill",       color: .blue,     label: "Com BPM importado",  value: "\(s.withBPM)")
                Divider().padding(.leading, 44)
                ResultRow(icon: "questionmark.circle",  color: .secondary, label: "Não encontradas",   value: "\(s.notFound)")
            }
        }
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Fechar") { dismiss() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.return)
        }
        .padding(20)
    }
}

struct ResultRow: View {
    let icon: String
    let color: Color
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .font(.callout)
                .frame(width: 20)
            Text(label)
                .font(.callout)
            Spacer()
            Text(value)
                .font(.callout.bold().monospacedDigit())
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}
