import SwiftUI

struct MissingMetaPromptSheet: View {
    let summary: MissingMetaSummary
    let onEnrich: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(
                            colors: [Color(red: 0.12, green: 0.62, blue: 0.40),
                                     Color(red: 0.18, green: 0.42, blue: 0.82)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ))
                        .frame(width: 44, height: 44)
                    Image(systemName: "sparkles")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Metadados Incompletos")
                        .font(.title3.bold())
                    Text("\(summary.total) faixas carregadas")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 14)

            Divider()

            // Detail
            VStack(alignment: .leading, spacing: 8) {
                Text("Foram identificados campos sem informação nos metadados. Deseja que eu busque e preencha automaticamente?")
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer().frame(height: 4)

                VStack(spacing: 4) {
                    if summary.missingGenre > 0 { metaRow("Gênero",  count: summary.missingGenre, total: summary.total, color: .purple) }
                    if summary.missingYear  > 0 { metaRow("Ano",     count: summary.missingYear,  total: summary.total, color: .orange) }
                    if summary.missingAlbum > 0 { metaRow("Álbum",   count: summary.missingAlbum, total: summary.total, color: .blue)   }
                    if summary.missingBPM   > 0 { metaRow("BPM",     count: summary.missingBPM,   total: summary.total, color: .green)  }
                }
                .padding(12)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal, 22)
            .padding(.top, 16)
            .padding(.bottom, 20)

            Divider()

            // Actions
            HStack(spacing: 10) {
                Button("Deixar para depois") { dismiss() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .keyboardShortcut(.escape, modifiers: [])

                Spacer()

                Button {
                    onEnrich()
                } label: {
                    Label("Enriquecer agora", systemImage: "sparkles")
                        .frame(minWidth: 160)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .keyboardShortcut(.return, modifiers: [])
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 14)
        }
        .frame(width: 420)
    }

    private func metaRow(_ field: String, count: Int, total: Int, color: Color) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(field)
                .font(.subheadline)
                .frame(width: 60, alignment: .leading)
            ProgressView(value: Double(count), total: Double(total))
                .tint(color)
                .frame(maxWidth: .infinity)
            Text("\(count) de \(total)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .trailing)
        }
    }
}
