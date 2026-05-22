import SwiftUI

struct ReviewQueueView: View {
    @Environment(AppState.self) private var state
    @State private var selectedItemId: ReviewItem.ID?

    var body: some View {
        @Bindable var state = state

        HSplitView {
            List(state.reviewQueue, selection: $selectedItemId) { item in
                HStack {
                    Image(systemName: item.isResolved ? "checkmark.circle.fill" : "questionmark.circle.fill")
                        .foregroundStyle(item.isResolved ? .green : .orange)
                        .font(.caption)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.track.title.isEmpty ? item.track.filename : item.track.title)
                            .font(.callout).lineLimit(1)
                        Text(item.track.artist.isEmpty ? "Artista desconhecido" : item.track.artist)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(item.matches.count) fonte\(item.matches.count == 1 ? "" : "s")")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .tag(item.id)
                .opacity(item.isSkipped ? 0.5 : 1)
            }
            .frame(minWidth: 200, maxWidth: 260)
            .onAppear {
                if selectedItemId == nil {
                    selectedItemId = state.reviewQueue.first?.id
                }
            }

            Group {
                if let id = selectedItemId,
                   let idx = state.reviewQueue.firstIndex(where: { $0.id == id }) {
                    ReviewItemDetail(item: $state.reviewQueue[idx])
                } else {
                    ContentUnavailableView("Selecione um item", systemImage: "list.bullet.clipboard")
                }
            }
        }
    }
}

struct ReviewItemDetail: View {
    @Binding var item: ReviewItem
    @Environment(AppState.self) private var state

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                trackInfo
                Divider()
                matchesSection
                Divider()
                actionButtons
            }
            .padding(16)
        }
    }

    private var trackInfo: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Faixa atual", systemImage: "music.note")
                .font(.caption.bold()).foregroundStyle(.secondary)
            Text(item.track.title.isEmpty ? "(sem título)" : item.track.title)
                .font(.headline)
            Text(item.track.artist)
                .font(.callout).foregroundStyle(.secondary)
            Text(item.track.filename)
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    private var matchesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Sugestões encontradas", systemImage: "sparkles")
                .font(.caption.bold()).foregroundStyle(.secondary)

            ForEach(item.matches) { match in
                MatchCard(match: match, isChosen: item.chosen?.id == match.id) {
                    item.chosen = match
                    applyChosen(match)
                }
            }
        }
    }

    private var actionButtons: some View {
        HStack {
            if !item.isResolved {
                Button("Ignorar") {
                    item.isSkipped = true
                }
                .buttonStyle(.bordered)
                .foregroundStyle(.secondary)
            }

            Spacer()

            if item.isResolved {
                Label("Aplicado", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.callout)
            }
        }
    }

    private func applyChosen(_ match: MetadataMatch) {
        // Usa o estado atual da faixa (não o snapshot da criação do review item)
        let base = state.tracks.first(where: { $0.id == item.track.id }) ?? item.track
        var updated = base
        if !match.title.isEmpty  { updated.title  = match.title }
        if !match.artist.isEmpty { updated.artist = match.artist }
        if !match.album.isEmpty  { updated.album  = match.album }
        if !match.year.isEmpty   { updated.year   = match.year }
        if !match.genre.isEmpty  { updated.genre  = match.genre }
        ValidationService.revalidate(&updated)

        Task {
            try? await TagWriter.shared.writeTags(to: updated)
            await MainActor.run {
                state.updateTrack(updated)
                let p = state.tracks.filter { $0.hasProblems }.count
                state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
            }
        }
    }
}

struct MatchCard: View {
    let match: MetadataMatch
    let isChosen: Bool
    let onApply: () -> Void

    var sourceColor: Color {
        switch match.source {
        case .musicBrainz: return .blue
        case .discogs:     return .purple
        case .acoustID:    return .orange
        case .spotify:     return .green
        case .lastFM:      return Color.orange.opacity(0.8)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(match.source.rawValue)
                    .font(.caption.bold())
                    .foregroundStyle(sourceColor)
                Spacer()
                ScoreBadge(score: match.score)
                if !isChosen {
                    Button("Aplicar", action: onApply)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                } else {
                    Label("Aplicado", systemImage: "checkmark.circle.fill")
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                }
            }

            Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 4) {
                if !match.title.isEmpty  { GridRow { Text("Título").fieldLabel();  Text(match.title).fieldValue() } }
                if !match.artist.isEmpty { GridRow { Text("Artista").fieldLabel(); Text(match.artist).fieldValue() } }
                if !match.album.isEmpty  { GridRow { Text("Álbum").fieldLabel();   Text(match.album).fieldValue() } }
                if !match.year.isEmpty   { GridRow { Text("Ano").fieldLabel();     Text(match.year).fieldValue() } }
                if !match.label.isEmpty  { GridRow { Text("Gravadora").fieldLabel(); Text(match.label).fieldValue() } }
                if !match.genre.isEmpty  { GridRow { Text("Gênero").fieldLabel();  Text(match.genre).fieldValue() } }
            }
        }
        .padding(10)
        .background(isChosen ? Color.green.opacity(0.08) : Color.secondary.opacity(0.07))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isChosen ? Color.green : Color.clear, lineWidth: 1.5))
        .cornerRadius(8)
    }
}

struct ScoreBadge: View {
    let score: Int
    var color: Color { score >= 90 ? .green : score >= 70 ? .orange : .red }

    var body: some View {
        Text("\(score)%")
            .font(.caption.bold())
            .foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(4)
    }
}

extension Text {
    func fieldLabel() -> some View {
        self.font(.caption).foregroundStyle(.secondary).frame(width: 60, alignment: .trailing)
    }
    func fieldValue() -> some View {
        self.font(.caption).lineLimit(1)
    }
}
