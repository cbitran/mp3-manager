import SwiftUI

struct InspectorView: View {
    @Environment(AppState.self) private var state
    @State private var editedTrack: Track?
    @State private var isSaving = false
    @State private var saveMessage: String?
    @State private var isRenaming = false
    @State private var coverImage: NSImage?
    @State private var pendingCoverURL: String = ""
    @State private var isEnrichingAll: Bool = false
    @State private var enrichSummary: String? = nil
    // Player + vinyl overlay
    @State private var player = AudioPlayerService.shared
    @State private var coverVinylDeg: Double = 0
    private let coverSpinTimer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()
    // mantidos para compatibilidade interna
    @State private var isSpotifyFetching: Bool = false
    @State private var spotifyInfo: SpotifyTrackInfo? = nil
    @State private var isITunesFetching: Bool = false

    private var isCurrentTrackPlaying: Bool {
        guard let t = editedTrack else { return false }
        return player.currentURL == t.url && player.isPlaying
    }

    var body: some View {
        Group {
            if state.selectedTrackIds.count > 1 {
                BatchTagEditorView()
                    .environment(state)
            } else if let track = editedTrack {
                trackEditor(track)
            } else {
                placeholderView
            }
        }
        .onChange(of: state.selectedTrackIds) { _, newIds in
            let single = newIds.count == 1 ? newIds.first : nil
            let t = state.tracks.first(where: { $0.id == single })
            editedTrack = t
            saveMessage = nil
            pendingCoverURL = ""
            coverImage = nil
            spotifyInfo = nil
            isSpotifyFetching = false
            isITunesFetching = false
            isEnrichingAll = false
            enrichSummary = nil
        }
        .onReceive(coverSpinTimer) { _ in
            guard isCurrentTrackPlaying else { return }
            coverVinylDeg = (coverVinylDeg + 2.0).truncatingRemainder(dividingBy: 360)
        }
        .navigationSplitViewColumnWidth(min: 280, ideal: 320)
    }

    private var placeholderView: some View {
        ContentUnavailableView(
            "Selecione uma faixa",
            systemImage: "music.note",
            description: Text("Clique em uma música na lista para ver e editar seus metadados.")
        )
    }

    @ViewBuilder
    private func trackEditor(_ track: Track) -> some View {
        VStack(spacing: 0) {
            coverArtSection(track)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    MiniPlayerView(track: track, showVinyl: !isCurrentTrackPlaying)
                    Divider()
                    filenameSection(track)
                    Divider()
                    tagsSection
                    Divider()
                    problemsSection(track)
                    Divider()
                    actionsSection(track)
                }
                .padding(16)
            }
        }
        .task(id: track.id) {
            coverImage = await TagService.shared.readCoverArt(from: track.url)
        }
    }

    // MARK: - Cover Art

    private func coverArtSection(_ track: Track) -> some View {
        let coverSize: CGFloat = 130
        return VStack(spacing: 8) {
            ZStack {
                // Capa de álbum
                Group {
                    if let img = coverImage {
                        Image(nsImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: coverSize, height: coverSize)
                    } else {
                        Rectangle()
                            .fill(Color.secondary.opacity(0.1))
                            .frame(width: coverSize, height: coverSize)
                            .overlay(
                                Image(systemName: "photo")
                                    .font(.system(size: 28))
                                    .foregroundStyle(.secondary.opacity(0.4))
                            )
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // Vinyl overlay quando tocando
                if isCurrentTrackPlaying {
                    ZStack {
                        Circle()
                            .fill(Color.black.opacity(0.72))
                            .frame(width: coverSize, height: coverSize)

                        ForEach([0.30, 0.40, 0.50, 0.60, 0.70], id: \.self) { f in
                            Circle()
                                .stroke(Color.white.opacity(0.05), lineWidth: 0.8)
                                .frame(width: coverSize * f, height: coverSize * f)
                        }

                        Circle()
                            .fill(LinearGradient(
                                colors: [Color.accentColor.opacity(0.9), Color.accentColor.opacity(0.5)],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            ))
                            .frame(width: coverSize * 0.27, height: coverSize * 0.27)

                        if !track.artist.isEmpty {
                            Text(String(track.artist.prefix(1)).uppercased())
                                .font(.system(size: coverSize * 0.10, weight: .bold))
                                .foregroundStyle(.white)
                        }

                        Circle()
                            .fill(Color.black.opacity(0.8))
                            .frame(width: coverSize * 0.055, height: coverSize * 0.055)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .rotationEffect(.degrees(coverVinylDeg))
                    .transition(.opacity.animation(.easeInOut(duration: 0.35)))
                }
            }
            .frame(width: coverSize, height: coverSize)
            .animation(.easeInOut(duration: 0.35), value: isCurrentTrackPlaying)
            .onTapGesture { pickCoverImage() }
            .help("Clique para alterar a capa")

            VStack(spacing: 2) {
                Text(track.title.isEmpty ? "(sem título)" : track.title)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text(track.artist.isEmpty ? "Artista desconhecido" : track.artist)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 6) {
                Button("Alterar Capa") { pickCoverImage() }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)

                if coverImage != nil {
                    Button("Remover") {
                        pendingCoverURL = "REMOVE"
                        coverImage = nil
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .foregroundStyle(.red)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: - Filename

    private func filenameSection(_ track: Track) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Arquivo", systemImage: "doc.fill")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Text(track.filename)
                .font(.caption)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .lineLimit(2)
        }
    }

    // MARK: - Tags

    @ViewBuilder
    private var tagsSection: some View {
        if let binding = editedTrackBinding {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Tags ID3", icon: "tag.fill")

                TagField(label: "Título", text: binding.title)
                TagField(label: "Artista", text: binding.artist)
                TagField(label: "Álbum", text: binding.album)
                TagField(label: "Ano", text: binding.year)

                HStack(spacing: 12) {
                    TagField(label: "Faixa", text: binding.trackNumber)
                    TagField(label: "Total", text: binding.totalTracks)
                }

                HStack(spacing: 12) {
                    TagField(label: "BPM", text: binding.bpm)
                    TagField(label: "Tom", text: binding.key)
                }

                enrichButton

                TagField(label: "Gênero", text: binding.genre)

                // Rating
                VStack(alignment: .leading, spacing: 4) {
                    Text("Avaliação")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        ForEach(1...5, id: \.self) { star in
                            Image(systemName: star <= (editedTrack?.rating ?? 0) ? "star.fill" : "star")
                                .font(.system(size: 18))
                                .foregroundStyle(
                                    star <= (editedTrack?.rating ?? 0)
                                        ? Color.yellow
                                        : Color.secondary.opacity(0.35)
                                )
                                .onTapGesture {
                                    let cur = editedTrack?.rating ?? 0
                                    editedTrack?.rating = (star == cur) ? 0 : star
                                }
                        }
                        if let r = editedTrack?.rating, r > 0 {
                            Text("(\(r)/5)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Problems

    private func problemsSection(_ track: Track) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Problemas Detectados", icon: "exclamationmark.triangle.fill")

            if track.problems.isEmpty && track.ignoredProblems.isEmpty {
                Label("Nenhum problema encontrado", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.callout)
            } else {
                ForEach(track.problems, id: \.self) { problem in
                    HStack(alignment: .center, spacing: 8) {
                        Image(systemName: problem.icon)
                            .foregroundStyle(problem.severity == .error ? .red : .orange)
                            .font(.caption)
                            .frame(width: 14)
                        Text(problem.description)
                            .font(.caption)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button { ignoreProblem(problem, in: track) } label: {
                            Text("Ignorar").font(.caption2)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                    }
                }

                if !track.ignoredProblems.isEmpty {
                    Divider()
                    ForEach(Array(track.ignoredProblems).sorted(), id: \.self) { key in
                        HStack(spacing: 8) {
                            Image(systemName: "eye.slash")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(width: 14)
                            Text(suppressedLabel(key))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 4)
                            Button { restoreProblem(key, in: track) } label: {
                                Text("Restaurar").font(.caption2)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.mini)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func actionsSection(_ track: Track) -> some View {
        VStack(spacing: 6) {
            if let msg = saveMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
                    .frame(maxWidth: .infinity, alignment: .center)
            }

            HStack(spacing: 6) {
                // Ícone lápis — renomear arquivo
                Button {
                    renameFile(track)
                } label: {
                    Image(systemName: "pencil.and.scribble")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.bordered)
                .help("Renomear arquivo para 'Artista - Título.mp3'")
                .disabled(isRenaming)

                // Ícone desfazer
                Button {
                    editedTrack = state.tracks.first(where: { $0.id == track.id })
                    pendingCoverURL = ""
                    saveMessage = nil
                    Task { coverImage = await TagService.shared.readCoverArt(from: track.url) }
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.bordered)
                .help("Desfazer alterações não salvas")

                // Salvar Tags — único botão de destaque
                Button {
                    saveChanges(track)
                } label: {
                    Label(isSaving ? "Salvando…" : "Salvar Tags", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || editedTrack == nil)
            }
        }
    }

    // MARK: - Enriquecer Tudo

    private var enrichButton: some View {
        Button { enrichAll() } label: {
            HStack(spacing: 10) {
                if isEnrichingAll {
                    ProgressView()
                        .scaleEffect(0.75)
                        .tint(.white)
                        .frame(width: 18, height: 18)
                    Text("Buscando metadados…")
                        .font(.subheadline.weight(.semibold))
                } else if let summary = enrichSummary {
                    Image(systemName: summary.hasPrefix("Nenhum") ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                    Text(summary)
                        .font(.caption.weight(.medium))
                        .lineLimit(2)
                    Spacer()
                    Image(systemName: "arrow.clockwise")
                        .font(.caption)
                        .opacity(0.7)
                } else {
                    Image(systemName: "sparkles")
                        .font(.system(size: 18, weight: .semibold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Enriquecer Metadados")
                            .font(.subheadline.weight(.bold))
                        Text("Spotify · iTunes · Last.fm")
                            .font(.caption2)
                            .opacity(0.75)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .opacity(0.6)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity)
            .background(
                Group {
                    if isEnrichingAll {
                        Color.accentColor.opacity(0.35)
                    } else if enrichSummary != nil {
                        Color.green.opacity(0.22)
                    } else {
                        LinearGradient(
                            colors: [
                                Color(red: 0.12, green: 0.62, blue: 0.40),
                                Color(red: 0.18, green: 0.42, blue: 0.82)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                }
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 11))
            .shadow(color: Color(red: 0.12, green: 0.42, blue: 0.70).opacity(enrichSummary == nil && !isEnrichingAll ? 0.4 : 0), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
        .disabled(isEnrichingAll || editedTrack?.title.isEmpty == true)
        .animation(.easeInOut(duration: 0.2), value: isEnrichingAll)
        .animation(.easeInOut(duration: 0.2), value: enrichSummary)
    }

    private func enrichAll() {
        guard let track = editedTrack else { return }
        isEnrichingAll = true
        enrichSummary = nil

        Task {
            var gained: [String] = []

            // Fase 1: Spotify + iTunes + Last.fm em paralelo
            async let spotifyFetch = SpotifyService.shared.enrich(track)
            async let iTunesFetch  = iTunesSearchService.shared.search(track: track)
            async let lastFMFetch: String? = LastFMService.shared.isConfigured
                ? LastFMService.shared.topGenre(artist: track.artist, title: track.title)
                : nil

            let (spInfo, iTResult, lfGenre) = await (spotifyFetch, iTunesFetch, lastFMFetch)

            await MainActor.run {
                if let f = spInfo?.audioFeatures {
                    editedTrack?.bpm = f.bpm
                    editedTrack?.key = f.key
                    gained.append("BPM \(f.bpm) · \(f.key)")
                }
                if let info = spInfo {
                    if editedTrack?.album.isEmpty == true, !info.album.isEmpty {
                        editedTrack?.album = info.album
                        if !gained.contains("Álbum") { gained.append("Álbum") }
                    }
                    if editedTrack?.year.isEmpty == true, !info.year.isEmpty { editedTrack?.year = info.year }
                }
                if let r = iTResult {
                    if editedTrack?.genre.isEmpty == true, !r.genre.isEmpty { editedTrack?.genre = r.genre; gained.append("Gênero") }
                    if editedTrack?.year.isEmpty  == true, !r.year.isEmpty  { editedTrack?.year  = r.year }
                    if editedTrack?.album.isEmpty == true, !r.album.isEmpty {
                        editedTrack?.album = r.album
                        if !gained.contains("Álbum") { gained.append("Álbum") }
                    }
                } else if let g = lfGenre, editedTrack?.genre.isEmpty == true {
                    editedTrack?.genre = g
                    gained.append("Gênero")
                }
            }

            // Capa — iTunes (alta resolução)
            if let r = iTResult,
               let (image, data) = await iTunesSearchService.shared.downloadArtwork(from: r.artworkURL) {
                // Usa path resolvido para evitar problema de symlink /var → /private/var no Python
                let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
                    .resolvingSymlinksInPath()
                    .appendingPathComponent("mp3mgr_cover_\(UUID().uuidString).jpg")
                if (try? data.write(to: tmp)) != nil {
                    await MainActor.run {
                        coverImage = image
                        pendingCoverURL = tmp.path
                        gained.append("Capa")
                    }
                } else {
                    await MainActor.run { coverImage = image }
                }
            }

            // Finaliza: revalida problemas e mostra resumo imediatamente
            await MainActor.run {
                if var t = editedTrack {
                    ValidationService.revalidate(&t)
                    editedTrack = t
                }
                isEnrichingAll = false
                enrichSummary = gained.isEmpty
                    ? "Nenhum dado novo encontrado"
                    : "✓ " + gained.joined(separator: " · ")
            }

            // Fase 2: BPM via IA em background se ainda vazio (não bloqueia o botão)
            let needsBPM = await MainActor.run { editedTrack?.bpm.isEmpty == true }
            if needsBPM, let currentTrack = await MainActor.run(body: { editedTrack }) {
                Task(priority: .background) {
                    if let result = try? await AIBPMService.shared.analyze(track: currentTrack) {
                        await MainActor.run {
                            guard self.editedTrack?.id == currentTrack.id else { return }
                            self.editedTrack?.bpm = result.bpmStr
                            if let k = result.key, !k.isEmpty { self.editedTrack?.key = k }
                            if var t = self.editedTrack {
                                ValidationService.revalidate(&t)
                                self.editedTrack = t
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Spotify (individual — mantido para uso interno)

    @ViewBuilder
    private var spotifyRow: some View {
        HStack(spacing: 8) {
            if isSpotifyFetching {
                ProgressView().scaleEffect(0.65).frame(width: 16, height: 16)
                Text("Buscando no Spotify…")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
            } else if let info = spotifyInfo {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.green)
                if let f = info.audioFeatures {
                    Text("\(f.camelotKey)  ·  E \(Int(f.energy * 100))%  ·  D \(Int(f.danceability * 100))%")
                        .font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("Álbum/ano obtidos · BPM indisponível")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Button { fetchSpotify() } label: {
                    Image(systemName: "arrow.clockwise").font(.caption2)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
                .help("Buscar novamente no Spotify")
            } else {
                Spacer()
                Button { fetchSpotify() } label: {
                    Label("Spotify", systemImage: "waveform.circle.fill")
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .tint(.green)
                .help("Buscar BPM e tom musical via Spotify")
            }
        }
    }

    private func fetchCoverFromiTunes() {
        guard let track = editedTrack else { return }
        isITunesFetching = true
        Task {
            if let result = await iTunesSearchService.shared.search(track: track),
               let (image, data) = await iTunesSearchService.shared.downloadArtwork(from: result.artworkURL) {
                let tempURL = URL(fileURLWithPath: NSTemporaryDirectory())
                    .appendingPathComponent(UUID().uuidString + ".jpg")
                try? data.write(to: tempURL)
                await MainActor.run {
                    coverImage = image
                    pendingCoverURL = tempURL.path
                    // Preenche campos vazios encontrados junto com a capa
                    if editedTrack?.genre.isEmpty == true && !result.genre.isEmpty { editedTrack?.genre = result.genre }
                    if editedTrack?.year.isEmpty  == true && !result.year.isEmpty  { editedTrack?.year  = result.year  }
                    if editedTrack?.album.isEmpty == true && !result.album.isEmpty { editedTrack?.album = result.album }
                }
            }
            await MainActor.run { isITunesFetching = false }
        }
    }

    private func fetchSpotify() {
        guard let track = editedTrack else { return }
        isSpotifyFetching = true
        spotifyInfo = nil
        Task {
            let info = await SpotifyService.shared.enrich(track)
            await MainActor.run {
                isSpotifyFetching = false
                spotifyInfo = info
                if let info {
                    if let f = info.audioFeatures {
                        editedTrack?.bpm = f.bpm
                        editedTrack?.key = f.key
                    }
                    if editedTrack?.album.isEmpty == true && !info.album.isEmpty { editedTrack?.album = info.album }
                    if editedTrack?.year.isEmpty  == true && !info.year.isEmpty  { editedTrack?.year  = info.year  }
                }
            }
        }
    }

    // MARK: - Helpers

    private var editedTrackBinding: Binding<Track>? {
        guard editedTrack != nil else { return nil }
        return Binding(get: { editedTrack! }, set: { editedTrack = $0 })
    }

    private func saveChanges(_ track: Track) {
        guard let updated = editedTrack else { return }
        let cover = pendingCoverURL
        pendingCoverURL = ""
        saveAndUpdateTrack(updated, coverURL: cover)
    }

    private func saveAndUpdateTrack(_ track: Track, coverURL: String) {
        var updated = track
        isSaving = true
        saveMessage = nil
        Task { @MainActor in
            do {
                try await TagWriter.shared.writeTags(to: updated, coverURL: coverURL)
                ValidationService.revalidate(&updated)
                if !coverURL.isEmpty && coverURL != "REMOVE" {
                    updated.coverVersion += 1  // força CoverThumbView a recarregar da tabela
                    coverImage = NSImage(contentsOfFile: coverURL)
                } else if coverURL == "REMOVE" {
                    coverImage = nil
                }
                state.updateTrack(updated)
                editedTrack = updated
                let p = state.tracks.filter { $0.hasProblems }.count
                state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
                saveMessage = "✓ Tags salvas com sucesso"
            } catch {
                saveMessage = "✗ Erro: \(error.localizedDescription)"
            }
            isSaving = false
        }
    }

    private func renameFile(_ track: Track) {
        guard let updated = editedTrack else { return }
        isRenaming = true
        Task {
            do {
                let newURL = try await TagWriter.shared.renameFile(track: updated)
                var renamed = updated
                renamed.url = newURL
                ValidationService.revalidate(&renamed)
                state.updateTrack(renamed)
                editedTrack = renamed
                saveMessage = "✓ Arquivo renomeado"
            } catch {
                saveMessage = "✗ Erro ao renomear: \(error.localizedDescription)"
            }
            isRenaming = false
        }
    }

    private func pickCoverImage() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.jpeg, .png, .bmp, .tiff]
        panel.prompt = "Escolher Imagem de Capa"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        coverImage = NSImage(contentsOf: url)
        pendingCoverURL = url.path
    }

    private func ignoreProblem(_ problem: TrackProblem, in track: Track) {
        IgnoreService.ignore(problem.key, for: track.url)
        guard var updated = editedTrack else { return }
        updated.ignoredProblems.insert(problem.key)
        ValidationService.revalidate(&updated)
        state.updateTrack(updated)
        editedTrack = updated
    }

    private func restoreProblem(_ key: String, in track: Track) {
        IgnoreService.restore(key, for: track.url)
        guard var updated = editedTrack else { return }
        updated.ignoredProblems.remove(key)
        ValidationService.revalidate(&updated)
        state.updateTrack(updated)
        editedTrack = updated
    }

    private func suppressedLabel(_ key: String) -> String {
        switch key {
        case "missingAlbum":         return "Álbum vazio (ignorado)"
        case "missingTitle":         return "Título vazio (ignorado)"
        case "missingArtist":        return "Artista vazio (ignorado)"
        case "wrongYear":            return "Ano suspeito (ignorado)"
        case "spotidownloaderOrigin": return "SpotiDownloader (ignorado)"
        default:                     return "\(key) (ignorado)"
        }
    }
}

// MARK: - Reusable Components

struct TagField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            TextField(label, text: $text)
                .textFieldStyle(.roundedBorder)
                .font(.callout)
        }
    }
}

struct SectionHeader: View {
    let title: String
    let icon: String

    var body: some View {
        Label(title, systemImage: icon)
            .font(.caption.bold())
            .foregroundStyle(.secondary)
    }
}

struct MusicBrainzResultView: View {
    let result: MusicBrainzResult
    let track: Track
    let onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Score: \(result.score)%")
                    .font(.caption.bold())
                    .foregroundStyle(result.score >= 80 ? .green : .orange)
                Spacer()
                if !result.isFullMatch {
                    Button("Aplicar Sugestões", action: onApply)
                        .font(.caption)
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }

            MBRow(field: "Título", local: track.title, mb: result.mbTitle, match: result.titleMatch)
            MBRow(field: "Artista", local: track.artist, mb: result.mbArtist, match: result.artistMatch)
            MBRow(field: "Álbum", local: track.album, mb: result.mbAlbum, match: result.albumMatch)
            MBRow(field: "Ano", local: track.year, mb: result.mbYear, match: result.yearMatch)
        }
        .padding(10)
        .background(.quaternary)
        .cornerRadius(8)
    }
}

struct MBRow: View {
    let field: String
    let local: String
    let mb: String
    let match: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: match ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
                .foregroundStyle(match ? .green : .orange)
                .font(.caption)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(field + ":").font(.caption2).foregroundStyle(.secondary)
                if !match && !mb.isEmpty {
                    Text(mb).font(.caption).foregroundStyle(.orange)
                } else {
                    Text(local.isEmpty ? "—" : local).font(.caption)
                }
            }
        }
    }
}

// MARK: - Discogs Result View

struct DiscogsResultView: View {
    let result: MetadataMatch
    let track: Track
    let onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                if !result.coverArtURL.isEmpty, let url = URL(string: result.coverArtURL) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable().scaledToFill()
                                .frame(width: 60, height: 60)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        case .failure:
                            placeholderArt
                        default:
                            placeholderArt.overlay(ProgressView().scaleEffect(0.6))
                        }
                    }
                } else {
                    placeholderArt
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Score: \(result.score)%")
                            .font(.caption.bold())
                            .foregroundStyle(result.score >= 80 ? .green : .orange)
                        if !result.label.isEmpty {
                            Text("• \(result.label)").font(.caption).foregroundStyle(.secondary)
                        }
                        if !result.country.isEmpty {
                            Text("• \(result.country)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    if !result.genre.isEmpty {
                        Text(result.genre).font(.caption2).foregroundStyle(.secondary)
                    }
                    if !result.isHighConfidence {
                        Button("Aplicar Sugestões", action: onApply)
                            .font(.caption).buttonStyle(.bordered).controlSize(.mini)
                    }
                }
            }

            DiscogsRow(field: "Título",  local: track.title,  remote: result.title)
            DiscogsRow(field: "Artista", local: track.artist, remote: result.artist)
            DiscogsRow(field: "Álbum",   local: track.album,  remote: result.album)
            DiscogsRow(field: "Ano",     local: track.year,   remote: result.year)
            if !result.genre.isEmpty {
                DiscogsRow(field: "Gênero", local: track.genre, remote: result.genre)
            }
        }
        .padding(10)
        .background(.quaternary)
        .cornerRadius(8)
    }

    private var placeholderArt: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Color.secondary.opacity(0.15))
            .frame(width: 60, height: 60)
            .overlay(Image(systemName: "opticaldisc").foregroundStyle(.secondary))
    }
}

struct DiscogsRow: View {
    let field: String
    let local: String
    let remote: String

    private var match: Bool {
        let n = { (s: String) in s.lowercased().folding(options: .diacriticInsensitive, locale: .current) }
        return n(local) == n(remote)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: match ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
                .foregroundStyle(match ? .green : .orange)
                .font(.caption).frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(field + ":").font(.caption2).foregroundStyle(.secondary)
                if !match && !remote.isEmpty {
                    Text(remote).font(.caption).foregroundStyle(.orange)
                } else {
                    Text(local.isEmpty ? "—" : local).font(.caption)
                }
            }
        }
    }
}
