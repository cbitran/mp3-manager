import SwiftUI

struct MetadataEnrichResultsView: View {
    @Environment(AppState.self) private var state
    @State private var filterMode: FilterMode = .enriched

    enum FilterMode: String, CaseIterable {
        case enriched = "Enriquecidos"
        case skipped  = "Sem resultado"
    }

    private var enriched: [MetadataEnrichResult] { state.enrichResults.filter { $0.enriched } }
    private var skipped:  [MetadataEnrichResult] { state.enrichResults.filter { !$0.enriched } }

    private var displayed: [MetadataEnrichResult] {
        filterMode == .enriched ? enriched : skipped
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            statsBar
            Divider()
            filterBar
            Divider()
            resultList
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Label("Enriquecimento de Metadados", systemImage: "music.note.list")
                .font(.title3.bold())
            Spacer()
            Button("Fechar") { state.isShowingEnrichResults = false }
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    // MARK: - Stats

    private var statsBar: some View {
        HStack(spacing: 24) {
            statChip(
                value: enriched.count,
                label: "faixa\(enriched.count == 1 ? "" : "s") enriquecida\(enriched.count == 1 ? "" : "s")",
                color: .green
            )
            statChip(
                value: enriched.filter { $0.appliedGenre != nil }.count,
                label: "com gênero",
                color: .purple
            )
            statChip(
                value: enriched.filter { $0.appliedYear != nil }.count,
                label: "com ano",
                color: .blue
            )
            statChip(
                value: skipped.count,
                label: "sem resultado",
                color: .secondary
            )
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    private func statChip(value: Int, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Filter bar

    private var filterBar: some View {
        HStack {
            Picker("", selection: $filterMode) {
                ForEach(FilterMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue + "  \(mode == .enriched ? enriched.count : skipped.count)").tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 300)
            Spacer()
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
    }

    // MARK: - List

    private var resultList: some View {
        List(displayed) { result in
            EnrichResultRow(result: result)
        }
        .listStyle(.plain)
    }
}

// MARK: - EnrichResultRow

struct EnrichResultRow: View {
    let result: MetadataEnrichResult

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: result.enriched ? "checkmark.circle.fill" : "minus.circle")
                .foregroundStyle(result.enriched ? .green : .secondary)
                .font(.system(size: 16))

            VStack(alignment: .leading, spacing: 3) {
                Text(URL(fileURLWithPath: result.filename).deletingPathExtension().lastPathComponent)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)

                if result.enriched {
                    HStack(spacing: 6) {
                        if let g = result.appliedGenre {
                            enrichTag(label: g, icon: "music.note.list", color: .purple)
                        }
                        if let y = result.appliedYear {
                            enrichTag(label: y, icon: "calendar", color: .blue)
                        }
                        if let a = result.appliedAlbum {
                            enrichTag(label: a, icon: "opticaldisc", color: .teal)
                        }
                    }
                } else {
                    Text("Não encontrado no MusicBrainz")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if result.score > 0 {
                Text("\(result.score)%")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(result.score >= 85 ? .green : result.score >= 70 ? .orange : .secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func enrichTag(label: String, icon: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 9))
            Text(label).font(.caption2.weight(.medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(color.opacity(0.1))
        .clipShape(Capsule())
    }
}
