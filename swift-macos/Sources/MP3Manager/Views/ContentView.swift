import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var state
    @State private var filenameTagCandidates: [FilenameTagCandidate] = []
    @State private var showInspector: Bool = false
    @State private var showMetadataCapture: Bool = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var showQuickSettings: Bool = false
    @State private var detailWidth: CGFloat = 900

    var body: some View {
        @Bindable var state = state

        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView()
        } detail: {
            TrackListView()
                .modifier(ResponsiveInspector(
                    isNarrow: detailWidth < 560,
                    isPresented: $showInspector
                ))
                .background(
                    GeometryReader { geo in
                        Color.clear.onChange(of: geo.size.width, initial: true) { _, w in
                            detailWidth = w
                            if w < 560 && columnVisibility == .all {
                                withAnimation(.easeInOut(duration: 0.22)) {
                                    columnVisibility = .detailOnly
                                }
                            }
                        }
                    }
                )
        }
        .navigationSplitViewStyle(.prominentDetail)
        .onChange(of: state.selectedTrackIds) { _, newIds in
            withAnimation { showInspector = newIds.count >= 1 }
        }
        .onChange(of: state.tracks.isEmpty) { _, isEmpty in
            if isEmpty { withAnimation { showInspector = false } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openFolderRequest)) { _ in
            openFolderPicker()
        }
        .onReceive(NotificationCenter.default.publisher(for: .loadFolderForNavigation)) { notif in
            guard let url = notif.object as? URL else { return }
            Task { await performScan(url: url, recursive: false) }
        }
        .onAppear {
            state.restorePersistedFolders()
            if let url = state.lastPersistedFolder, state.tracks.isEmpty {
                Task { await performScan(url: url, recursive: false) }
            }
        }
        .toolbar {
            // Grupo 1: operações em lote (expansível conforme contexto)
            ToolbarItemGroup(placement: .automatic) {
                if state.isBatchBPMRunning {
                    BatchBPMProgressBar(
                        done:     state.batchBPMDone,
                        total:    state.batchBPMTotal,
                        current:  state.batchBPMCurrent,
                        progress: state.batchBPMProgress,
                        onCancel: { state.batchBPMTask?.cancel() }
                    )
                } else if state.isEnriching {
                    BatchProgressCard(
                        icon:     "music.note.list",
                        color:    .teal,
                        colors:   [.teal, .green],
                        name:     enrichTrackName(state.enrichCurrent),
                        done:     state.enrichDone,
                        total:    state.enrichTotal,
                        progress: state.enrichProgress,
                        onCancel: { state.enrichTask?.cancel() }
                    )
                } else if state.isSpotifyEnriching {
                    BatchProgressCard(
                        icon:     "waveform.circle.fill",
                        color:    .green,
                        colors:   [.green, .mint],
                        name:     enrichTrackName(state.spotifyEnrichCurrent),
                        done:     state.spotifyEnrichDone,
                        total:    state.spotifyEnrichTotal,
                        progress: state.spotifyEnrichProgress,
                        onCancel: { state.spotifyEnrichTask?.cancel() }
                    )
                } else if state.isITunesEnriching {
                    BatchProgressCard(
                        icon:     "photo.circle.fill",
                        color:    .pink,
                        colors:   [.pink, .red],
                        name:     enrichTrackName(state.iTunesEnrichCurrent),
                        done:     state.iTunesEnrichDone,
                        total:    state.iTunesEnrichTotal,
                        progress: state.iTunesEnrichProgress,
                        onCancel: { state.iTunesEnrichTask?.cancel() }
                    )
                } else if state.isLastFMEnriching {
                    BatchProgressCard(
                        icon:     "tag.circle.fill",
                        color:    .red,
                        colors:   [.red, .orange],
                        name:     enrichTrackName(state.lastFMEnrichCurrent),
                        done:     state.lastFMEnrichDone,
                        total:    state.lastFMEnrichTotal,
                        progress: state.lastFMEnrichProgress,
                        onCancel: { state.lastFMEnrichTask?.cancel() }
                    )
                } else if !state.tracks.isEmpty && state.selectedFolder != nil {
                    Button {
                        runBatchBPM()
                    } label: {
                        Image(systemName: "waveform.badge.magnifyingglass")
                    }
                    .help("BPM em Lote — Analisar BPM de todas as faixas com IA")

                    Button {
                        runBatchEnrich()
                    } label: {
                        Image(systemName: "music.note.list")
                    }
                    .help("Enriquecer — Buscar gênero, ano e álbum via MusicBrainz")

                    Button {
                        runUnifiedBatchEnrich()
                    } label: {
                        Image(systemName: "sparkles")
                    }
                    .help(state.selectedTrackIds.isEmpty
                          ? "Enriquecer em Lote — Spotify · iTunes · Last.fm em todas as faixas"
                          : "Enriquecer em Lote — \(state.selectedTrackIds.count) faixas selecionadas")

                    Button {
                        showMetadataCapture = true
                    } label: {
                        Image(systemName: "sparkles.rectangle.stack")
                    }
                    .help("Capturar Metadados — Identificar faixas via MusicBrainz e AcoustID")
                    .sheet(isPresented: $showMetadataCapture) {
                        let targets = metadataCaptureTargets()
                        MetadataCaptureView(tracks: targets.isEmpty ? state.tracks : targets)
                            .environment(state)
                    }
                }
            }

            // Grupo 2: ações permanentes
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    state.isShowingAssistant = true
                } label: {
                    Image(systemName: "sparkles")
                }
                .help("Assistente — Encontre músicas por nome, artista, gênero...")

                if state.reviewQueue.contains(where: { !$0.isResolved }) {
                    Button {
                        state.isShowingReviewQueue = true
                    } label: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .help("Revisão pendente")
                }

                if !state.duplicateGroups.isEmpty {
                    Button {
                        state.isShowingDuplicates = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 14))
                            Text("\(state.duplicateGroups.count)")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(2)
                                .background(Color.orange)
                                .clipShape(Circle())
                                .offset(x: 6, y: -6)
                        }
                    }
                    .help("Duplicatas — \(state.duplicateGroups.count) grupo\(state.duplicateGroups.count == 1 ? "" : "s")")
                } else if state.isDuplicateScanning {
                    ProgressView().scaleEffect(0.6).frame(width: 16, height: 16)
                        .help("Verificando duplicatas…")
                }

                Button {
                    openFolderPicker()
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .help("Abrir Pasta")

                Button {
                    showQuickSettings.toggle()
                } label: {
                    Image(systemName: "gear")
                }
                .help("Configurações Rápidas")
                .popover(isPresented: $showQuickSettings, arrowEdge: .bottom) {
                    QuickSettingsPopover()
                        .environment(state)
                }

                if state.isScanning {
                    ScanningToolbarIndicator(done: state.scanDone, total: state.scanTotal)
                        .help("Escaneando pasta…")
                }
            }
        }
        .sheet(isPresented: $state.isShowingScanPreview) {
            if let preview = state.scanPreview {
                FolderPreviewSheet(preview: preview) { recursive in
                    guard let url = state.pendingScanURL else { return }
                    Task { await performScan(url: url, recursive: recursive) }
                }
                .environment(state)
            }
        }
        .sheet(isPresented: $state.isShowingFilenameTagPrompt) {
            FilenameTagSheet(
                candidates: filenameTagCandidates,
                onApply: { selected in applyFilenameTags(selected) },
                onSkip: {}
            )
        }
        .sheet(isPresented: $state.isShowingBatchBPMResults) {
            BatchBPMResultsView().environment(state)
        }
        .sheet(isPresented: $state.isShowingAssistant) {
            AssistantView().environment(state)
        }
        .sheet(isPresented: $state.isShowingDuplicates) {
            DuplicatesView().environment(state)
        }
        .sheet(isPresented: $state.isShowingEnrichResults) {
            MetadataEnrichResultsView().environment(state)
        }
        .sheet(isPresented: $state.isShowingMissingMetaPrompt) {
            if let summary = state.missingMetaSummary {
                MissingMetaPromptSheet(summary: summary) {
                    state.isShowingMissingMetaPrompt = false
                    runUnifiedBatchEnrich()
                }
            }
        }
        .frame(minWidth: 750, minHeight: 500)
    }

    private func metadataCaptureTargets() -> [Track] {
        if !state.selectedTrackIds.isEmpty {
            return state.tracks.filter { state.selectedTrackIds.contains($0.id) }
        }
        return state.tracks.filter { track in
            track.problems.contains { p in
                if case .missingTitle = p { return true }
                if case .missingArtist = p { return true }
                return false
            }
        }
    }

    private func openFolderPicker() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Escolher Pasta"
        panel.message = "Selecione a pasta com os arquivos MP3"

        guard panel.runModal() == .OK, let url = panel.url else { return }

        Task { await buildPreview(for: url) }
    }

    @MainActor
    private func buildPreview(for url: URL) async {
        state.statusMessage = "Calculando prévia…"
        do {
            let preview = try await TagService.shared.buildPreview(for: url)
            state.pendingScanURL = url
            state.scanPreview = preview
            state.addRecentFolder(url)
            state.isShowingScanPreview = true
        } catch {
            state.statusMessage = "Erro: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func performScan(url: URL, recursive: Bool) async {
        state.selectedFolder = url
        state.selectedTrackId = nil
        state.isScanning = true
        state.tracks = []
        state.scanDone = 0
        state.scanTotal = 0
        state.scanProgress = 0
        state.statusMessage = "Escaneando \(url.lastPathComponent)\(recursive ? " (recursivo)" : "")…"

        do {
            let tracks = try await TagService.shared.scanFolder(url, recursive: recursive) { @MainActor track, done, total in
                guard state.selectedFolder == url else { return }
                state.tracks.append(track)
                state.scanDone = done
                state.scanTotal = total
                state.scanProgress = Double(done) / Double(total)
            }

            guard state.selectedFolder == url else {
                state.isScanning = false
                return
            }

            // Garante que state.tracks está completo e em ordem
            if state.tracks.count != tracks.count {
                state.tracks = tracks
            }
            state.scanProgress = 1.0

            // Navegação pendente (ex: "Ir para" do Assistente)
            if let targetURL = state.pendingNavigationURL {
                state.pendingNavigationURL = nil
                if let match = tracks.first(where: { $0.url == targetURL }) {
                    state.selectedTrackIds = [match.id]
                }
            }

            let problems = tracks.filter { $0.hasProblems }.count
            state.statusMessage = "\(tracks.count) músicas • \(problems) com problemas"

            let candidates = tracks.compactMap { track -> FilenameTagCandidate? in
                guard FilenameParser.canPopulate(track: track) else { return nil }
                guard let parsed = FilenameParser.parse(filename: track.filename) else { return nil }
                return FilenameTagCandidate(track: track, parsed: parsed)
            }

            if !candidates.isEmpty {
                filenameTagCandidates = candidates
                state.isShowingFilenameTagPrompt = true
            } else {
                checkAndPromptMissingMeta(tracks: tracks)
            }

            if tracks.count > 1 {
                Task { await runDuplicateDetection(tracks: tracks) }
            }
        } catch {
            if state.selectedFolder == url {
                state.statusMessage = "Erro: \(error.localizedDescription)"
            }
        }

        state.isScanning = false
    }

    private func checkAndPromptMissingMeta(tracks: [Track]) {
        guard tracks.count >= 5 else { return }
        let missingGenre = tracks.filter { $0.genre.isEmpty }.count
        let missingYear  = tracks.filter { $0.year.isEmpty || $0.year == "1970" }.count
        let missingAlbum = tracks.filter { $0.album.isEmpty }.count
        let missingBPM   = tracks.filter { $0.bpm.isEmpty }.count
        let keyMissing   = missingGenre + missingYear + missingAlbum
        guard keyMissing > max(3, tracks.count / 4) else { return }
        state.missingMetaSummary = MissingMetaSummary(
            missingGenre: missingGenre,
            missingYear:  missingYear,
            missingAlbum: missingAlbum,
            missingBPM:   missingBPM,
            total:        tracks.count
        )
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 600_000_000)
            state.isShowingMissingMetaPrompt = true
        }
    }

    @MainActor
    private func applyFilenameTags(_ selected: [FilenameTagCandidate]) {
        for candidate in selected {
            guard var track = state.tracks.first(where: { $0.id == candidate.track.id }) else { continue }
            let parsed = candidate.parsed
            if track.title.isEmpty,  !parsed.title.isEmpty  { track.title  = parsed.title }
            if track.artist.isEmpty, !parsed.artist.isEmpty { track.artist = parsed.artist }
            if track.trackNumber.isEmpty, !parsed.trackNumber.isEmpty { track.trackNumber = parsed.trackNumber }
            ValidationService.revalidate(&track)
            state.updateTrack(track)
        }
        let count = selected.count
        state.statusMessage = "✓ Tags populadas em \(count) faixa\(count == 1 ? "" : "s") a partir dos nomes de arquivo"

        Task {
            for candidate in selected {
                guard let track = state.tracks.first(where: { $0.id == candidate.track.id }) else { continue }
                try? await TagWriter.shared.writeTags(to: track)
            }
        }
    }

    @MainActor
    private func runBatchEnrich() {
        guard !state.isEnriching && !state.isBatchBPMRunning else { return }
        let tracks = state.tracks
        state.enrichTask = Task {
            await MusicBrainzService.shared.batchEnrich(tracks: tracks, appState: state)
        }
    }

    @MainActor
    private func runDuplicateDetection(tracks: [Track]) async {
        state.isDuplicateScanning = true
        state.duplicateGroups = []
        let groups = await DuplicateDetector.detect(in: tracks)
        state.duplicateGroups = groups
        state.isDuplicateScanning = false
    }

    @MainActor
    private func runBatchBPM() {
        guard !state.isBatchBPMRunning else { return }
        let tracks = state.tracks
        state.batchBPMTask = Task {
            await AIBPMService.shared.batchAnalyzeAndWrite(tracks: tracks, appState: state)
        }
    }

    @MainActor
    private func runUnifiedBatchEnrich() {
        let anyRunning = state.isSpotifyEnriching || state.isITunesEnriching ||
                         state.isLastFMEnriching  || state.isBatchBPMRunning  || state.isEnriching
        guard !anyRunning else { return }

        let tracks = state.selectedTrackIds.isEmpty
            ? state.tracks
            : state.tracks.filter { state.selectedTrackIds.contains($0.id) }

        let trackedIds = Set(tracks.map(\.id))

        state.spotifyEnrichTask = Task {
            // 1. Spotify (BPM + álbum + ano)
            await SpotifyService.shared.batchEnrich(tracks: tracks, appState: state)
            // 2. iTunes (gênero + capa + ano + álbum para os que ficaram vazios)
            let remaining = await MainActor.run { state.tracks.filter { trackedIds.contains($0.id) } }
            state.iTunesEnrichTask = Task {
                await iTunesSearchService.shared.batchEnrich(tracks: remaining, appState: state)
            }
            await state.iTunesEnrichTask?.value
            // 3. Last.fm (gênero via comunidade para os que ainda não têm)
            if LastFMService.shared.isConfigured {
                let noGenre = await MainActor.run {
                    state.tracks.filter { trackedIds.contains($0.id) && $0.genre.isEmpty }
                }
                if !noGenre.isEmpty {
                    state.lastFMEnrichTask = Task {
                        await LastFMService.shared.batchEnrichGenre(tracks: noGenre, appState: state)
                    }
                    await state.lastFMEnrichTask?.value
                }
            }
            // 4. Fallback local: Tom via IA para faixas que ainda não têm
            let noKey = await MainActor.run {
                state.tracks.filter { trackedIds.contains($0.id) && $0.key.isEmpty }
            }
            if !noKey.isEmpty {
                await MainActor.run { runKeyFallback(tracks: noKey) }
            }
        }
    }

    @MainActor
    private func runKeyFallback(tracks: [Track]) {
        guard !tracks.isEmpty else { return }
        Task { @MainActor in
            for track in tracks {
                if Task.isCancelled { break }
                state.batchBPMActiveIds.insert(track.id)
                do {
                    let result = try await AIBPMService.shared.analyze(track: track)
                    if let key = result.key, !key.isEmpty {
                        var updated = state.tracks.first(where: { $0.id == track.id }) ?? track
                        updated.key = key
                        if updated.bpm.isEmpty { updated.bpm = result.bpmStr }
                        ValidationService.revalidate(&updated)
                        state.updateTrack(updated)
                        try? await TagWriter.shared.writeTags(to: updated)
                    }
                } catch {}
                state.batchBPMActiveIds.remove(track.id)
            }
        }
    }

    // Mantidos para uso interno dos BatchProgressCards existentes
    @MainActor
    private func runSpotifyEnrich() { runUnifiedBatchEnrich() }

    @MainActor
    private func runITunesEnrich() { runUnifiedBatchEnrich() }

    @MainActor
    private func runLastFMEnrich() { runUnifiedBatchEnrich() }

}

// MARK: - Scanning Toolbar Indicator

struct ScanningToolbarIndicator: View {
    let done: Int
    let total: Int
    @State private var rotation: Double = 0

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .rotationEffect(.degrees(rotation))
                .onAppear {
                    withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                        rotation = 360
                    }
                }
            if total > 0 {
                Text("\(done)/\(total)")
                    .font(.caption2.weight(.medium).monospacedDigit())
                    .foregroundStyle(Color.accentColor)
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.1), value: done)
            } else {
                Text("Escaneando…")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.accentColor.opacity(0.1))
        .clipShape(Capsule())
    }
}

// MARK: - Batch Progress Toolbar Items

private func enrichTrackName(_ current: String, maxLen: Int = 24) -> String {
    guard !current.isEmpty else { return "Buscando…" }
    let name = URL(fileURLWithPath: current).deletingPathExtension().lastPathComponent
    return name.count > maxLen ? String(name.prefix(maxLen)) + "…" : name
}

private func batchTrackName(_ current: String, maxLen: Int = 24) -> String {
    guard !current.isEmpty else { return "Analisando…" }
    let name = URL(fileURLWithPath: current).deletingPathExtension().lastPathComponent
    return name.count > maxLen ? String(name.prefix(maxLen)) + "…" : name
}

struct BatchBPMProgressBar: View {
    let done: Int
    let total: Int
    let current: String
    let progress: Double
    let onCancel: () -> Void

    var body: some View {
        BatchProgressCard(
            icon:     "waveform.badge.magnifyingglass",
            color:    .purple,
            colors:   [.purple, .indigo],
            name:     batchTrackName(current),
            done:     done,
            total:    total,
            progress: progress,
            onCancel: onCancel
        )
    }
}

struct BatchProgressCard: View {
    let icon: String
    let color: Color
    let colors: [Color]
    let name: String
    let done: Int
    let total: Int
    let progress: Double
    let onCancel: (() -> Void)?

    private let barWidth: CGFloat = 120

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(color)
                .symbolEffect(.variableColor.iterative, options: .repeating)

            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(minWidth: 120, maxWidth: 150, alignment: .leading)

                HStack(spacing: 6) {
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(color.opacity(0.15))
                            .frame(height: 4)
                        Capsule()
                            .fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(4, barWidth * progress), height: 4)
                            .animation(.linear(duration: 0.25), value: progress)
                    }
                    .frame(width: barWidth)

                    Text("\(done)/\(total)")
                        .font(.caption2.bold().monospacedDigit())
                        .foregroundStyle(color)
                }
            }

            if let cancel = onCancel {
                Button(action: cancel) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Cancelar análise")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
    }
}

// MARK: - ResponsiveInspector

private struct ResponsiveInspector: ViewModifier {
    @Environment(AppState.self) private var state
    let isNarrow: Bool
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        if isNarrow {
            content
                .overlay(alignment: .trailing) {
                    if isPresented {
                        InspectorView()
                            .frame(width: 300)
                            .background(.regularMaterial, in: Rectangle())
                            .shadow(color: .black.opacity(0.22), radius: 18, x: -4, y: 0)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing).combined(with: .opacity),
                                removal:   .move(edge: .trailing).combined(with: .opacity)
                            ))
                            .animation(.easeInOut(duration: 0.22), value: isPresented)
                            .overlay(alignment: .topLeading) {
                                Button {
                                    withAnimation { isPresented = false }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 16))
                                        .foregroundStyle(.secondary)
                                        .padding(10)
                                }
                                .buttonStyle(.plain)
                                .help("Fechar inspector")
                            }
                    }
                }
        } else {
            content
                .inspector(isPresented: $isPresented) {
                    InspectorView()
                        .inspectorColumnWidth(min: 280, ideal: 320, max: 420)
                }
        }
    }
}
