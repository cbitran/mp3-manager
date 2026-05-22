import SwiftUI

struct BatchTagEditorView: View {
    @Environment(AppState.self) private var state

    @State private var genre  = ""
    @State private var album  = ""
    @State private var year   = ""
    @State private var artist = ""
    @State private var bpm    = ""
    @State private var key    = ""

    @State private var applyGenre  = false
    @State private var applyAlbum  = false
    @State private var applyYear   = false
    @State private var applyArtist = false
    @State private var applyBPM    = false
    @State private var applyKey    = false

    @State private var isSaving    = false
    @State private var saveMessage: String?
    @State private var savedCount  = 0

    @State private var isBatchEnriching = false
    @State private var enrichedCount    = 0
    @State private var enrichTotal      = 0

    private var selectedTracks: [Track] {
        state.tracks.filter { state.selectedTrackIds.contains($0.id) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                headerSection
                Divider()
                enrichAllButton
                Divider()
                fieldsSection
                Divider()
                summarySection
                Divider()
                actionsSection
            }
            .padding(16)
        }
        .navigationSplitViewColumnWidth(min: 280, ideal: 320)
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Edição em Lote", systemImage: "pencil.and.list.clipboard")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Text("\(selectedTracks.count) faixas selecionadas")
                .font(.callout.bold())
            Text("Marque e preencha os campos que deseja sobrescrever em todas as faixas.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var fieldsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Campos a alterar", icon: "tag.fill")
            BatchCheckField(label: "Gênero",  value: $genre,  enabled: $applyGenre,  hint: common(\.genre))
            BatchCheckField(label: "Álbum",   value: $album,  enabled: $applyAlbum,  hint: common(\.album))
            BatchCheckField(label: "Ano",     value: $year,   enabled: $applyYear,   hint: common(\.year))
            BatchCheckField(label: "Artista", value: $artist, enabled: $applyArtist, hint: common(\.artist))
            BatchCheckField(label: "BPM",     value: $bpm,    enabled: $applyBPM,    hint: common(\.bpm))
            BatchCheckField(label: "Tom",     value: $key,    enabled: $applyKey,    hint: common(\.key))
        }
    }

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: "Valores atuais", icon: "info.circle")
            ForEach(summaryRows, id: \.0) { field, values in
                HStack(alignment: .top, spacing: 4) {
                    Text(field + ":")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 54, alignment: .leading)
                    Text(values)
                        .font(.caption2)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var actionsSection: some View {
        VStack(spacing: 8) {
            if isSaving {
                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.7)
                    Text("Salvando… \(savedCount)/\(selectedTracks.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if let msg = saveMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
            }

            Button {
                applyBatch()
            } label: {
                Label(
                    "Aplicar em \(selectedTracks.count) faixas",
                    systemImage: "square.and.arrow.down.on.square"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSaving || !hasAnyEnabled)
        }
    }

    // MARK: - Helpers

    private var hasAnyEnabled: Bool {
        applyGenre || applyAlbum || applyYear || applyArtist || applyBPM || applyKey
    }

    private func common(_ kp: KeyPath<Track, String>) -> String {
        let values = Set(selectedTracks.map { $0[keyPath: kp] }.filter { !$0.isEmpty })
        return values.count == 1 ? values.first! : ""
    }

    private var summaryRows: [(String, String)] {
        func summary(_ kp: KeyPath<Track, String>) -> String {
            let nonEmpty = selectedTracks.map { $0[keyPath: kp] }.filter { !$0.isEmpty }
            if nonEmpty.isEmpty { return "sem valor" }
            let unique = Set(nonEmpty)
            if unique.count == 1 { return unique.first! }
            if unique.count <= 4 { return unique.sorted().joined(separator: ", ") }
            return "\(unique.count) valores diferentes"
        }
        return [
            ("Gênero",  summary(\.genre)),
            ("Álbum",   summary(\.album)),
            ("Ano",     summary(\.year)),
            ("Artista", summary(\.artist)),
            ("BPM",     summary(\.bpm)),
        ]
    }

    // MARK: - Enriquecer em Lote

    private var enrichAllButton: some View {
        Button { batchEnrichAll() } label: {
            HStack(spacing: 10) {
                if isBatchEnriching {
                    ProgressView().scaleEffect(0.75).tint(.white).frame(width: 18, height: 18)
                    Text("Enriquecendo \(enrichedCount)/\(enrichTotal)…")
                        .font(.subheadline.weight(.semibold))
                } else if let msg = saveMessage, msg.hasPrefix("✓ \(savedCount == 0 ? enrichedCount : 0)") {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 16, weight: .semibold))
                    Text(msg).font(.caption.weight(.medium)).lineLimit(2)
                    Spacer()
                    Image(systemName: "arrow.clockwise").font(.caption).opacity(0.7)
                } else {
                    Image(systemName: "sparkles").font(.system(size: 18, weight: .semibold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Enriquecer \(selectedTracks.count) Faixas")
                            .font(.subheadline.weight(.bold))
                        Text("Spotify · iTunes · Last.fm")
                            .font(.caption2).opacity(0.75)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).opacity(0.6)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11).frame(maxWidth: .infinity)
            .background(
                isBatchEnriching
                    ? AnyShapeStyle(Color.accentColor.opacity(0.35))
                    : AnyShapeStyle(LinearGradient(
                        colors: [Color(red: 0.12, green: 0.62, blue: 0.40), Color(red: 0.18, green: 0.42, blue: 0.82)],
                        startPoint: .leading, endPoint: .trailing
                    ))
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 11))
            .shadow(color: Color(red: 0.12, green: 0.42, blue: 0.70).opacity(isBatchEnriching ? 0 : 0.4), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
        .disabled(isBatchEnriching || isSaving)
        .animation(.easeInOut(duration: 0.2), value: isBatchEnriching)
    }

    private func batchEnrichAll() {
        let tracks = selectedTracks
        isBatchEnriching = true
        enrichedCount = 0
        enrichTotal = tracks.count

        Task { @MainActor in
            for var track in tracks {
                async let spotifyFetch = SpotifyService.shared.enrich(track)
                async let iTunesFetch  = iTunesSearchService.shared.search(track: track)
                async let lfFetch: String? = LastFMService.shared.isConfigured
                    ? LastFMService.shared.topGenre(artist: track.artist, title: track.title)
                    : nil

                let (spInfo, iTResult, lfGenre) = await (spotifyFetch, iTunesFetch, lfFetch)

                if let f = spInfo?.audioFeatures { track.bpm = f.bpm; track.key = f.key }
                if let info = spInfo {
                    if track.album.isEmpty, !info.album.isEmpty { track.album = info.album }
                    if track.year.isEmpty,  !info.year.isEmpty  { track.year  = info.year }
                }
                if let r = iTResult {
                    if track.genre.isEmpty, !r.genre.isEmpty { track.genre = r.genre }
                    if track.year.isEmpty,  !r.year.isEmpty  { track.year  = r.year }
                    if track.album.isEmpty, !r.album.isEmpty { track.album = r.album }
                } else if let g = lfGenre, track.genre.isEmpty {
                    track.genre = g
                }

                // Capa via iTunes
                if let r = iTResult,
                   let (_, data) = await iTunesSearchService.shared.downloadArtwork(from: r.artworkURL) {
                    let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
                        .resolvingSymlinksInPath()
                        .appendingPathComponent("mp3mgr_cover_\(UUID().uuidString).jpg")
                    if (try? data.write(to: tmp)) != nil {
                        track.coverVersion += 1
                        try? await TagWriter.shared.writeTags(to: track, coverURL: tmp.path)
                        try? FileManager.default.removeItem(at: tmp)
                    } else {
                        try? await TagWriter.shared.writeTags(to: track)
                    }
                } else {
                    try? await TagWriter.shared.writeTags(to: track)
                }

                ValidationService.revalidate(&track)
                state.updateTrack(track)
                enrichedCount += 1
            }

            let p = state.tracks.filter { $0.hasProblems }.count
            state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
            saveMessage = "✓ \(enrichedCount) faixas enriquecidas"
            isBatchEnriching = false
        }
    }

    // MARK: - Apply

    private func applyBatch() {
        isSaving = true
        saveMessage = nil
        savedCount = 0

        Task { @MainActor in
            for var track in selectedTracks {
                if applyGenre  { track.genre  = genre  }
                if applyAlbum  { track.album  = album  }
                if applyYear   { track.year   = year   }
                if applyArtist { track.artist = artist }
                if applyBPM    { track.bpm    = bpm    }
                if applyKey    { track.key    = key    }
                ValidationService.revalidate(&track)
                state.updateTrack(track)
                try? await TagWriter.shared.writeTags(to: track)
                savedCount += 1
            }
            let p = state.tracks.filter { $0.hasProblems }.count
            state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
            saveMessage = "✓ \(savedCount) faixas atualizadas"
            isSaving = false
        }
    }
}

// MARK: - BatchCheckField

struct BatchCheckField: View {
    let label: String
    @Binding var value: String
    @Binding var enabled: Bool
    let hint: String

    var body: some View {
        HStack(spacing: 8) {
            Toggle("", isOn: $enabled)
                .toggleStyle(.checkbox)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(enabled ? .primary : .secondary)
                TextField(hint.isEmpty ? "Novo valor…" : hint, text: $value)
                    .textFieldStyle(.roundedBorder)
                    .font(.callout)
                    .disabled(!enabled)
                    .opacity(enabled ? 1 : 0.55)
                    .onChange(of: value) { _, v in
                        if !v.isEmpty { enabled = true }
                    }
            }
        }
    }
}
