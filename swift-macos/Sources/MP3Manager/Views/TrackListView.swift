import SwiftUI

struct TrackListView: View {
    @Environment(AppState.self) private var state
    @State private var sortOrder = [KeyPathComparator(\Track.title)]
    @State private var filterMode: FilterMode = .all
    @AppStorage("trackTableColumnCustomization_v3")
    private var columnCustomization: TableColumnCustomization<Track>
    @State private var showColumnPicker = false

    // Busca inteligente com tokens
    @State private var searchText: String = ""
    @State private var searchTokens: [String] = []
    @State private var searchScope: SearchScope = .folder
    @State private var isCompact: Bool = false

    enum SearchScope { case folder, library }

    // Criação de playlist
    @State private var isShowingPlaylistSheet = false
    @State private var playlistSheetTracks: [Track] = []

    // Filtros avançados
    @State private var showFilterPopover = false
    @State private var filterGenre   = ""
    @State private var filterArtist  = ""
    @State private var filterKey     = ""
    @State private var filterBPMMin  = ""
    @State private var filterBPMMax  = ""
    @State private var filterYearMin = ""
    @State private var filterYearMax = ""

    // Exportação
    @State private var isShowingExport = false
    @State private var exportTracks: [Track] = []

    // Exclusão
    @State private var showDeleteConfirmation = false
    @State private var pendingDeleteTracks: [Track] = []

    enum FilterMode: String, CaseIterable {
        case all       = "Todas"
        case favorites = "★"
        case problems  = "Com Problemas"
        case clean     = "OK"
    }

    private var isAdvancedFilterActive: Bool {
        !filterGenre.isEmpty || !filterArtist.isEmpty || !filterKey.isEmpty ||
        !filterBPMMin.isEmpty || !filterBPMMax.isEmpty ||
        !filterYearMin.isEmpty || !filterYearMax.isEmpty
    }

    private var sourcePool: [Track] {
        if searchScope == .library && !state.libraryTracks.isEmpty {
            return state.libraryTracks
        }
        return state.tracks
    }

    var filteredTracks: [Track] {
        let pool = sourcePool
        let base: [Track]
        switch filterMode {
        case .all:       base = pool
        case .favorites: base = pool.filter { state.isTrackFavorite($0.url) }
        case .problems:  base = pool.filter { $0.hasProblems }
        case .clean:     base = pool.filter { !$0.hasProblems }
        }
        var result = isAdvancedFilterActive ? base.filter { applyAdvancedFilter($0) } : base
        let live = searchText.trimmingCharacters(in: .whitespaces)
        if !searchTokens.isEmpty || !live.isEmpty {
            let tokens = searchTokens + (live.isEmpty ? [] : [live])
            result = result.filter { track in tokens.allSatisfy { matchToken($0, track: track) } }
        }
        return result
    }

    private func matchToken(_ token: String, track: Track) -> Bool {
        let t = token.lowercased()
        return track.title.lowercased().contains(t)
            || track.artist.lowercased().contains(t)
            || track.album.lowercased().contains(t)
            || track.genre.lowercased().contains(t)
            || track.bpm.contains(t)
            || track.key.lowercased().contains(t)
            || track.year.prefix(4).contains(t)
            || track.comment.lowercased().contains(t)
            || track.filename.lowercased().contains(t)
    }

    private func commitToken() {
        let token = searchText.trimmingCharacters(in: .whitespaces)
        searchText = ""
        guard !token.isEmpty, !searchTokens.contains(token) else { return }
        searchTokens.append(token)
    }

    private func applyAdvancedFilter(_ t: Track) -> Bool {
        if !filterGenre.isEmpty,  !t.genre.localizedCaseInsensitiveContains(filterGenre)   { return false }
        if !filterArtist.isEmpty, !t.artist.localizedCaseInsensitiveContains(filterArtist) { return false }
        if !filterKey.isEmpty,    !t.key.localizedCaseInsensitiveContains(filterKey)       { return false }
        if let min = Double(filterBPMMin), let bpm = Double(t.bpm), bpm < min { return false }
        if let max = Double(filterBPMMax), let bpm = Double(t.bpm), bpm > max { return false }
        if let min = Int(filterYearMin), let y = Int(t.year.prefix(4)), y < min { return false }
        if let max = Int(filterYearMax), let y = Int(t.year.prefix(4)), y > max { return false }
        return true
    }

    private var tracksForExport: [Track] {
        state.selectedTrackIds.count > 1
            ? state.tracks.filter { state.selectedTrackIds.contains($0.id) }
            : filteredTracks
    }

    private var problemCount:   Int { state.problemTracks.count }
    private var cleanCount:     Int { state.cleanTracks.count }
    private var favoriteCount:  Int { state.tracks.filter { state.isTrackFavorite($0.url) }.count }

    private var bpmCompatibleIds: Set<Track.ID> {
        guard let selId = state.selectedTrackId,
              let sel   = state.tracks.first(where: { $0.id == selId }),
              let bpm   = Double(sel.bpm), bpm > 0 else { return [] }
        let lo = bpm * 0.94; let hi  = bpm * 1.06
        let hLo = bpm * 0.47; let hHi = bpm * 0.53
        let dLo = bpm * 1.94; let dHi = bpm * 2.06
        return Set(sourcePool.compactMap { t -> Track.ID? in
            guard t.id != selId, let tbpm = Double(t.bpm), tbpm > 0 else { return nil }
            return (tbpm >= lo && tbpm <= hi) || (tbpm >= hLo && tbpm <= hHi) || (tbpm >= dLo && tbpm <= dHi)
                ? t.id : nil
        })
    }

    private func label(_ mode: FilterMode) -> String {
        switch mode {
        case .all:       return "Todas"
        case .favorites: return favoriteCount > 0 ? "★  \(favoriteCount)" : "★"
        case .problems:  return problemCount > 0 ? "Problemas  \(problemCount)" : "Problemas"
        case .clean:     return cleanCount   > 0 ? "OK  \(cleanCount)"          : "OK"
        }
    }

    var body: some View {
        @Bindable var state = state

        VStack(spacing: 0) {
            Button("Excluir selecionadas") { requestDelete() }
                .keyboardShortcut(.delete, modifiers: [])
                .frame(width: 0, height: 0)
                .opacity(0)
                .disabled(state.selectedTrackIds.isEmpty)

            // Barra de controles só aparece quando há tracks carregados
            if !state.tracks.isEmpty || state.isScanning {
                controlBar
                Divider()
            }

            Group {
                if state.isScanning && state.tracks.isEmpty {
                    scanProgressView
                } else if state.tracks.isEmpty {
                    emptyState
                } else {
                    TrackTable(
                        tracks: filteredTracks,
                        selection: $state.selectedTrackIds,
                        sortOrder: $sortOrder,
                        columnCustomization: $columnCustomization,
                        activeIds: state.batchBPMActiveIds,
                        enrichCurrentId: state.enrichCurrentId,
                        bpmCompatibleIds: bpmCompatibleIds,
                        isCompact: isCompact
                    )
                    .onChange(of: sortOrder) { _, new in
                        state.tracks.sort(using: new)
                    }
                    .contextMenu(forSelectionType: Track.ID.self) { ids in
                        if !ids.isEmpty {
                            Button {
                                let urls = ids.compactMap { id in
                                    state.tracks.first(where: { $0.id == id })?.url
                                }
                                NSWorkspace.shared.activateFileViewerSelecting(urls)
                            } label: {
                                Label(
                                    ids.count == 1 ? "Mostrar no Finder" : "Mostrar no Finder (\(ids.count) faixas)",
                                    systemImage: "magnifyingglass"
                                )
                            }
                        }

                        if !state.isBatchBPMRunning && !ids.isEmpty {
                            Divider()
                            Button {
                                let selected = ids.compactMap { id in
                                    state.tracks.first(where: { $0.id == id })
                                }
                                if selected.count == 1 {
                                    analyzeSingleBPM(for: selected[0])
                                } else if !selected.isEmpty {
                                    state.batchBPMTask = Task {
                                        await AIBPMService.shared.batchAnalyzeAndWrite(tracks: selected, appState: state)
                                    }
                                }
                            } label: {
                                Label(
                                    ids.count == 1 ? "Analisar BPM com IA" : "Analisar BPM com IA (\(ids.count) faixas)",
                                    systemImage: "waveform.badge.magnifyingglass"
                                )
                            }
                        }

                        if !ids.isEmpty {
                            Divider()
                            Button {
                                let selected = ids.compactMap { id in
                                    state.tracks.first(where: { $0.id == id })
                                }
                                playlistSheetTracks = selected
                                isShowingPlaylistSheet = true
                            } label: {
                                Label(
                                    ids.count == 1
                                        ? "Criar Playlist com esta Faixa"
                                        : "Criar Playlist com \(ids.count) Faixas",
                                    systemImage: "music.note.list"
                                )
                            }
                        }

                        if !ids.isEmpty {
                            Divider()
                            Button(role: .destructive) {
                                pendingDeleteTracks = ids.compactMap { id in
                                    state.tracks.first(where: { $0.id == id })
                                }
                                showDeleteConfirmation = true
                            } label: {
                                Label(
                                    ids.count == 1 ? "Excluir Faixa…" : "Excluir \(ids.count) Faixas…",
                                    systemImage: "trash"
                                )
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(state.selectedFolder?.lastPathComponent ?? "Músicas")
        .navigationSplitViewColumnWidth(min: 380, ideal: 600)
        .sheet(isPresented: $isShowingExport) {
            ExportFolderView(tracks: exportTracks)
                .environment(state)
        }
        .sheet(isPresented: $isShowingPlaylistSheet) {
            CreatePlaylistSheet(tracks: playlistSheetTracks)
        }
        .confirmationDialog(
            confirmDeleteTitle,
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Mover para a Lixeira", role: .destructive) { performTrash() }
            Button("Remover da Lista") { performRemoveFromList() }
            Button("Cancelar", role: .cancel) { pendingDeleteTracks = [] }
        } message: {
            Text(confirmDeleteMessage)
        }
    }

    // MARK: - Control Bar (busca + filtros + colunas sempre visíveis)

    private var controlBar: some View {
        VStack(spacing: 0) {
            searchBar
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 6)

            HStack(spacing: 6) {
                Picker("", selection: $filterMode) {
                    ForEach(FilterMode.allCases, id: \.self) { mode in
                        Text(label(mode)).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 280)

                Spacer(minLength: 8)

                Button {
                    showFilterPopover.toggle()
                } label: {
                    Image(systemName: isAdvancedFilterActive
                          ? "line.3.horizontal.decrease.circle.fill"
                          : "line.3.horizontal.decrease.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(isAdvancedFilterActive ? Color.accentColor : .secondary)
                }
                .buttonStyle(.plain)
                .help(isAdvancedFilterActive ? "Filtros avançados ativos — clique para editar" : "Filtros avançados")
                .popover(isPresented: $showFilterPopover, arrowEdge: .bottom) {
                    filterPopover
                }

                Button {
                    state.selectedTrackIds = Set(filteredTracks.map { $0.id })
                } label: {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Selecionar todas as faixas visíveis (\(filteredTracks.count))")

                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { isCompact.toggle() }
                } label: {
                    Image(systemName: isCompact ? "list.bullet" : "list.bullet.indent")
                        .font(.system(size: 14))
                        .foregroundStyle(isCompact ? Color.accentColor : .secondary)
                }
                .buttonStyle(.plain)
                .help(isCompact ? "Modo normal" : "Modo compacto")
                .disabled(filteredTracks.isEmpty)

                Button {
                    showColumnPicker.toggle()
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Personalizar colunas — mostrar, ocultar e reordenar")
                .popover(isPresented: $showColumnPicker, arrowEdge: .bottom) {
                    columnPickerPopover
                }

                Button {
                    exportTracks = tracksForExport
                    isShowingExport = true
                } label: {
                    Image(systemName: "arrow.up.doc.on.clipboard")
                        .font(.system(size: 14))
                        .foregroundStyle(tracksForExport.isEmpty ? .tertiary : .secondary)
                }
                .buttonStyle(.plain)
                .disabled(tracksForExport.isEmpty)
                .help("Exportar \(tracksForExport.count) faixas para outra pasta")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }

    @ViewBuilder
    private var scopeButton: some View {
        let isLib = searchScope == .library
        Menu {
            Button {
                searchScope = .folder
            } label: {
                Label("Esta pasta", systemImage: "folder")
            }
            Divider()
            if state.isIndexingLibrary {
                Label("Indexando biblioteca…", systemImage: "arrow.clockwise")
            } else if state.libraryTracks.isEmpty && !state.libraryRootPath.isEmpty {
                Button {
                    searchScope = .library
                } label: {
                    Label("Toda a biblioteca (não indexada)", systemImage: "music.note.house")
                }
            } else if !state.libraryTracks.isEmpty {
                Button {
                    searchScope = .library
                } label: {
                    Label("Toda a biblioteca (\(state.libraryTracks.count) faixas)", systemImage: "music.note.house")
                }
            }
        } label: {
            HStack(spacing: 3) {
                Image(systemName: isLib ? "music.note.house.fill" : "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundStyle(isLib ? Color.accentColor : Color.secondary.opacity(0.5))
                if isLib {
                    Text("Biblioteca")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }

    private var searchBar: some View {
        HStack(spacing: 6) {
            if !state.libraryRootPath.isEmpty || !state.libraryTracks.isEmpty {
                scopeButton
            } else {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.tertiary)
                    .font(.system(size: 13))
            }

            ForEach(searchTokens, id: \.self) { token in
                tokenChip(token)
            }

            TextField(
                searchTokens.isEmpty
                    ? (searchScope == .library ? "Buscar em toda a biblioteca…" : "Buscar por artista, título, BPM, gênero…")
                    : "Adicionar filtro…",
                text: $searchText
            )
            .textFieldStyle(.plain)
            .font(.callout)
            .onSubmit { commitToken() }
            .onChange(of: searchText) { _, new in
                guard !new.isEmpty, new.last == " " || new.last == "," else { return }
                let raw = String(new.dropLast()).trimmingCharacters(in: .whitespaces)
                searchText = ""
                guard !raw.isEmpty, !searchTokens.contains(raw) else { return }
                searchTokens.append(raw)
            }

            if !searchTokens.isEmpty || !searchText.isEmpty {
                Text("\(filteredTracks.count) de \(state.tracks.count)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.15), value: filteredTracks.count)
                Button {
                    searchText = ""
                    searchTokens = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func tokenChip(_ token: String) -> some View {
        HStack(spacing: 3) {
            Text(token).font(.caption.weight(.medium))
            Button {
                searchTokens.removeAll { $0 == token }
            } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(Color.accentColor.opacity(0.15), in: Capsule())
        .foregroundStyle(Color.accentColor)
    }

    // MARK: - Empty / Scanning

    private var emptyState: some View {
        ContentUnavailableView(
            "Nenhuma pasta aberta",
            systemImage: "folder.badge.questionmark",
            description: Text("Use Arquivo → Abrir Pasta ou ⌘O para carregar uma pasta com MP3s.")
        )
    }

    private var scanProgressView: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .stroke(Color.accentColor.opacity(0.15), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: state.scanProgress)
                    .stroke(
                        LinearGradient(
                            colors: [Color.accentColor, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: 5, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.2), value: state.scanProgress)

                VStack(spacing: 1) {
                    Text("\(Int(state.scanProgress * 100))%")
                        .font(.system(size: 20, weight: .bold).monospacedDigit())
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.2), value: state.scanProgress)
                    Image(systemName: "music.note")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 90, height: 90)

            VStack(spacing: 5) {
                if state.scanTotal > 0 {
                    Text("\(state.scanDone) de \(state.scanTotal) faixas")
                        .font(.title3.weight(.semibold))
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.15), value: state.scanDone)
                } else {
                    Text("Localizando arquivos…")
                        .font(.title3.weight(.semibold))
                }
                if let folder = state.selectedFolder?.lastPathComponent {
                    Text(folder)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Column Picker Popover

    private let allColumns: [(id: String, label: String)] = [
        ("status",      "● Status"),
        ("favorite",    "★ Favorita"),
        ("cover",       "⬜ Capa"),
        ("tracknumber", "#  Faixa"),
        ("title",       "Título"),
        ("artist",      "Artista"),
        ("album",       "Álbum"),
        ("year",        "Ano"),
        ("bpm",         "BPM"),
        ("key",         "Tom"),
        ("waveform",    "〜 Forma de Onda"),
        ("rating",      "★ Avaliação"),
        ("genre",       "Gênero"),
        ("duration",    "Tempo"),
        ("filesize",    "Tamanho"),
        ("filetype",    "Tipo"),
        ("dateadded",   "Adicionada"),
        ("comment",     "Comentário"),
    ]

    private var columnPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Colunas visíveis", systemImage: "slider.horizontal.3")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Restaurar") {
                    columnCustomization = TableColumnCustomization<Track>()
                }
                .font(.caption2)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 6)

            Divider()

            ForEach(allColumns, id: \.id) { col in
                let isVisible = columnCustomization[visibility: col.id] != .hidden
                Button {
                    columnCustomization[visibility: col.id] = isVisible ? .hidden : .visible
                } label: {
                    HStack {
                        Image(systemName: isVisible ? "checkmark" : "")
                            .frame(width: 16)
                            .foregroundStyle(Color.accentColor)
                        Text(col.label)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
            }
            .padding(.bottom, 6)
        }
        .frame(width: 210)
    }

    // MARK: - Filter Popover

    private var filterPopover: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Filtros Avançados")
                    .font(.headline)
                Spacer()
                if isAdvancedFilterActive {
                    Button("Limpar") {
                        filterGenre = ""; filterArtist = ""; filterKey = ""
                        filterBPMMin = ""; filterBPMMax = ""
                        filterYearMin = ""; filterYearMax = ""
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .foregroundStyle(.orange)
                }
            }

            Divider()

            FilterPopoverField(label: "Gênero",  value: $filterGenre,  placeholder: "Ex: Rock, Eletrônica…")
            FilterPopoverField(label: "Artista", value: $filterArtist, placeholder: "Nome do artista…")
            FilterPopoverField(label: "Tom",     value: $filterKey,    placeholder: "Ex: Am, C, F#m…")

            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("BPM mínimo").font(.caption2).foregroundStyle(.secondary)
                    TextField("Ex: 120", text: $filterBPMMin)
                        .textFieldStyle(.roundedBorder).font(.callout).frame(width: 90)
                }
                Text("–").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text("BPM máximo").font(.caption2).foregroundStyle(.secondary)
                    TextField("Ex: 140", text: $filterBPMMax)
                        .textFieldStyle(.roundedBorder).font(.callout).frame(width: 90)
                }
            }

            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Ano inicial").font(.caption2).foregroundStyle(.secondary)
                    TextField("Ex: 1980", text: $filterYearMin)
                        .textFieldStyle(.roundedBorder).font(.callout).frame(width: 90)
                }
                Text("–").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Ano final").font(.caption2).foregroundStyle(.secondary)
                    TextField("Ex: 1989", text: $filterYearMax)
                        .textFieldStyle(.roundedBorder).font(.callout).frame(width: 90)
                }
            }

            if filteredTracks.count != state.tracks.count {
                Divider()
                Text("\(filteredTracks.count) de \(state.tracks.count) faixas visíveis")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(width: 260)
    }

    // MARK: - Delete

    private var confirmDeleteTitle: String {
        guard !pendingDeleteTracks.isEmpty else { return "Excluir?" }
        if pendingDeleteTracks.count == 1 {
            let name = pendingDeleteTracks[0].title.isEmpty
                ? pendingDeleteTracks[0].filename
                : pendingDeleteTracks[0].title
            return "Excluir \"\(name)\"?"
        }
        return "Excluir \(pendingDeleteTracks.count) faixas?"
    }

    private var confirmDeleteMessage: String {
        pendingDeleteTracks.count == 1
            ? "Escolha se quer apagar o arquivo do disco ou apenas removê-lo desta lista."
            : "Escolha se quer apagar os \(pendingDeleteTracks.count) arquivos do disco ou apenas removê-los desta lista."
    }

    private func requestDelete() {
        guard !state.selectedTrackIds.isEmpty else { return }
        pendingDeleteTracks = state.tracks.filter { state.selectedTrackIds.contains($0.id) }
        showDeleteConfirmation = true
    }

    private func performTrash() {
        let ids = Set(pendingDeleteTracks.map { $0.id })
        for track in pendingDeleteTracks {
            try? FileManager.default.trashItem(at: track.url, resultingItemURL: nil)
        }
        state.tracks.removeAll { ids.contains($0.id) }
        state.selectedTrackIds.subtract(ids)
        pendingDeleteTracks = []
    }

    private func performRemoveFromList() {
        let ids = Set(pendingDeleteTracks.map { $0.id })
        state.tracks.removeAll { ids.contains($0.id) }
        state.selectedTrackIds.subtract(ids)
        pendingDeleteTracks = []
    }

    // MARK: - BPM single analysis

    private func analyzeSingleBPM(for track: Track) {
        Task { @MainActor in
            guard !state.isBatchBPMRunning else { return }
            state.batchBPMActiveIds.insert(track.id)
            state.statusMessage = "Analisando BPM: \(track.filename)…"
            do {
                let result = try await AIBPMService.shared.analyzeAndWrite(track: track)
                var updated = track
                updated.bpm = result.bpmStr
                if let k = result.key, !k.isEmpty { updated.key = k }
                if let cues = result.cuePoints, !cues.isEmpty {
                    updated.djData = AIBPMService.shared.applyAICues(
                        cues, to: updated.djData, bpm: result.bpmStr, key: result.key ?? ""
                    )
                }
                ValidationService.revalidate(&updated)
                state.updateTrack(updated)
                let keyInfo = result.key.map { ", Tom: \($0)" } ?? ""
                state.statusMessage = "BPM: \(result.bpmStr)\(keyInfo) — \(track.filename)"
            } catch {
                state.statusMessage = "Erro ao analisar BPM: \(error.localizedDescription)"
            }
            state.batchBPMActiveIds.remove(track.id)
        }
    }
}

// MARK: - FilterPopoverField

struct FilterPopoverField: View {
    let label: String
    @Binding var value: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            HStack(spacing: 4) {
                TextField(placeholder, text: $value)
                    .textFieldStyle(.roundedBorder)
                    .font(.callout)
                if !value.isEmpty {
                    Button { value = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - StarRatingView

struct StarRatingView: View {
    let rating: Int
    let onRate: (Int) -> Void

    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: star <= rating ? "star.fill" : "star")
                    .font(.system(size: 9))
                    .foregroundStyle(star <= rating ? Color.yellow : Color.secondary.opacity(0.3))
                    .contentShape(Rectangle())
                    .onTapGesture { onRate(star == rating ? 0 : star) }
            }
        }
    }
}

// MARK: - TrackTable

private let shortDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateStyle = .short
    f.timeStyle = .none
    return f
}()

private struct TrackTable: View {
    @Environment(AppState.self) private var state
    let tracks: [Track]
    @Binding var selection: Set<Track.ID>
    @Binding var sortOrder: [KeyPathComparator<Track>]
    @Binding var columnCustomization: TableColumnCustomization<Track>
    let activeIds: Set<Track.ID>
    let enrichCurrentId: Track.ID?
    var bpmCompatibleIds: Set<Track.ID> = []
    var isCompact: Bool = false

    var body: some View {
        Table(tracks, selection: $selection, sortOrder: $sortOrder, columnCustomization: $columnCustomization) {
            Group {
                colTrackNumber
                colFavorite
                colCover
                colWaveform
                colStatus
                colArtist
                colTitle
                colBpm
                colGenre
            }
            Group {
                colKey
                colYear
                colAlbum
                colDuration
                colFileSize
                colFileType
                colDateAdded
                colRating
                colComment
            }
        }
        .onChange(of: sortOrder) { _, _ in }
    }

    // MARK: Columns

    private var colStatus: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("", value: \.title) { (track: Track) in
            let isActive = activeIds.contains(track.id) || enrichCurrentId == track.id
            RowStatusIndicator(severity: track.problemSeverity, isAnalyzing: isActive)
        }
        .width(20)
        .customizationID("status")
    }

    private var colFavorite: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("", value: \.rating) { (track: Track) in
            let fav = state.isTrackFavorite(track.url)
            Image(systemName: fav ? "star.fill" : "star")
                .font(.system(size: 10))
                .foregroundStyle(fav ? Color.yellow : Color.secondary.opacity(0.22))
                .contentShape(Rectangle())
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onTapGesture { state.toggleTrackFavorite(track.url) }
        }
        .width(22)
        .customizationID("favorite")
    }

    private var colCover: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Capa", value: \.album) { (track: Track) in
            let sz: CGFloat = isCompact ? 18 : 26
            CoverThumbView(url: track.url, version: track.coverVersion, size: sz)
        }
        .width(isCompact ? 26 : 34)
        .customizationID("cover")
    }

    private var colWaveform: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Forma de Onda", value: \.bpm) { (track: Track) in
            WaveformBarView(url: track.url)
                .frame(height: isCompact ? 14 : 22)
        }
        .width(min: 80, ideal: 120, max: 200)
        .customizationID("waveform")
    }

    private var colTrackNumber: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("#", value: \.trackNumber) { (track: Track) in
            Text(track.trackNumber.isEmpty ? "—" : track.trackNumber)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .width(32)
        .customizationID("tracknumber")
    }

    private var colTitle: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Título", value: \.title) { (track: Track) in
            Text(track.title.isEmpty ? "(sem título)" : track.title)
                .foregroundStyle(track.title.isEmpty ? .secondary : .primary)
                .lineLimit(1)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) {
                    NSWorkspace.shared.open(track.url)
                }
        }
        .customizationID("title")
    }

    private var colArtist: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Artista", value: \.artist) { (track: Track) in
            Text(track.artist.isEmpty ? "—" : track.artist)
                .foregroundStyle(track.artist.isEmpty ? .secondary : .primary)
                .lineLimit(1)
        }
        .customizationID("artist")
    }

    private var colAlbum: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Álbum", value: \.album) { (track: Track) in
            Text(track.album.isEmpty ? "—" : track.album)
                .foregroundStyle(.secondary).lineLimit(1)
        }
        .customizationID("album")
    }

    private var colYear: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Ano", value: \.year) { (track: Track) in
            Text(track.year.isEmpty ? "—" : String(track.year.prefix(4)))
                .foregroundStyle(track.year == "1970" ? .orange : .primary)
                .monospacedDigit()
        }
        .width(50)
        .customizationID("year")
    }

    private var colBpm: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("BPM", value: \.bpm) { (track: Track) in
            let compat = bpmCompatibleIds.contains(track.id)
            HStack(spacing: 3) {
                if compat {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 5, height: 5)
                }
                Text(track.bpm.isEmpty ? "—" : formatBPM(track.bpm))
                    .foregroundStyle(compat ? Color.green : .secondary)
                    .fontWeight(compat ? .semibold : .regular)
                    .monospacedDigit()
            }
        }
        .width(60)
        .customizationID("bpm")
    }

    private var colKey: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Tom", value: \.key) { (track: Track) in
            if track.key.isEmpty {
                Text("—").foregroundStyle(.secondary)
            } else {
                Text(track.key)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(camelotColor(track.key).opacity(0.75),
                                in: RoundedRectangle(cornerRadius: 4))
            }
        }
        .width(44)
        .customizationID("key")
    }

    private var colRating: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("★", value: \.rating) { (track: Track) in
            StarRatingView(rating: track.rating) { newRating in
                rateTrack(track, rating: newRating)
            }
        }
        .width(72)
        .customizationID("rating")
    }

    private var colGenre: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Gênero", value: \.genre) { (track: Track) in
            Text(track.genre.isEmpty ? "—" : track.genre)
                .foregroundStyle(.secondary).lineLimit(1)
        }
        .customizationID("genre")
    }

    private var colDuration: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Tempo", value: \.duration) { (track: Track) in
            Text(track.duration > 0 ? formatDuration(track.duration) : "—")
                .foregroundStyle(.secondary).monospacedDigit()
        }
        .width(60)
        .customizationID("duration")
    }

    private var colFileSize: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Tamanho", value: \.fileSize) { (track: Track) in
            Text(track.fileSize > 0 ? formatFileSize(track.fileSize) : "—")
                .foregroundStyle(.secondary).monospacedDigit()
        }
        .width(70)
        .customizationID("filesize")
    }

    private var colFileType: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Tipo", value: \.fileType) { (track: Track) in
            Text(track.fileType.isEmpty ? "—" : track.fileType)
                .foregroundStyle(.secondary)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
        }
        .width(46)
        .customizationID("filetype")
    }

    private var colDateAdded: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Adicionada", value: \.dateAdded) { (track: Track) in
            Text(track.dateAdded == .distantPast ? "—" : shortDateFormatter.string(from: track.dateAdded))
                .foregroundStyle(.secondary)
                .font(.system(size: 11))
        }
        .width(88)
        .customizationID("dateadded")
    }

    private var colComment: some TableColumnContent<Track, KeyPathComparator<Track>> {
        TableColumn("Comentário", value: \.comment) { (track: Track) in
            Text(track.comment.isEmpty ? "—" : track.comment)
                .foregroundStyle(.secondary).lineLimit(1)
        }
        .customizationID("comment")
    }

    // MARK: Rating action

    private func rateTrack(_ track: Track, rating: Int) {
        var updated = track
        updated.rating = rating
        state.updateTrack(updated)
        Task { try? await TagWriter.shared.writeTags(to: updated) }
    }
}

private struct CoverThumbView: View {
    let url: URL
    var version: Int = 0
    var size: CGFloat = 26
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let img = image {
                Image(nsImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: max(2, size * 0.12)))
            } else {
                RoundedRectangle(cornerRadius: max(2, size * 0.12))
                    .fill(Color.secondary.opacity(0.1))
                    .frame(width: size, height: size)
                    .overlay(
                        Image(systemName: "photo")
                            .font(.system(size: size * 0.38))
                            .foregroundStyle(.secondary.opacity(0.35))
                    )
            }
        }
        .task(id: "\(url)\(version)") {
            image = await TagService.shared.readCoverArt(from: url)
        }
    }
}

private struct WaveformBarView: View {
    let url: URL
    @State private var bars: [WaveformBar] = []

    var body: some View {
        Canvas { context, size in
            let barW: CGFloat = 0.8
            let gap:  CGFloat = 0.2
            let step  = barW + gap
            let count = max(1, Int(size.width / step))
            let midY  = size.height / 2

            if bars.isEmpty {
                for i in 0..<count {
                    let rect = CGRect(x: CGFloat(i) * step, y: midY - 1.5, width: barW, height: 3)
                    context.fill(Path(roundedRect: rect, cornerRadius: 0.3),
                                 with: .color(Color.secondary.opacity(0.08)))
                }
            } else {
                let sampleStep = max(1, bars.count / count)
                for i in 0..<count {
                    let bar = bars[min(i * sampleStep, bars.count - 1)]
                    let h   = max(1.5, pow(CGFloat(bar.amplitude), 0.65) * midY)
                    let rect = CGRect(x: CGFloat(i) * step, y: midY - h, width: barW, height: h * 2)
                    let r = min(1.0, Double(bar.low)  * 1.5)
                    let g = min(1.0, Double(bar.mid)  * 1.3)
                    let b = min(1.0, Double(bar.high) * 1.7)
                    context.fill(Path(roundedRect: rect, cornerRadius: 0.3),
                                 with: .color(Color(red: r, green: g, blue: b)))
                }
            }
        }
        .task(id: url) {
            bars = await WaveformGenerator.generate(url: url)
        }
    }
}

// Camelot Wheel: mapeamento de tonalidade → posição no círculo harmônico
private func camelotColor(_ key: String) -> Color {
    // Normaliza: aceita "Am", "A minor", "4A", "4B", etc.
    let k = key.trimmingCharacters(in: .whitespaces)

    // Camelot notation (e.g. "1A", "12B")
    let camelotPattern = /^(\d{1,2})([ABab])$/
    if let m = try? camelotPattern.firstMatch(in: k),
       let num = Int(String(m.1)) {
        return camelotHue(num, isMinor: m.2.lowercased() == "a")
    }

    // Standard notation map → Camelot position
    let map: [String: (Int, Bool)] = [
        "Abm": (1, true),  "G#m": (1, true),  "B":   (1, false),
        "Ebm": (2, true),  "D#m": (2, true),  "Gb":  (2, false), "F#": (2, false),
        "Bbm": (3, true),  "A#m": (3, true),  "Db":  (3, false), "C#": (3, false),
        "Fm":  (4, true),                     "Ab":  (4, false), "G#": (4, false),
        "Cm":  (5, true),                     "Eb":  (5, false), "D#": (5, false),
        "Gm":  (6, true),                     "Bb":  (6, false), "A#": (6, false),
        "Dm":  (7, true),                     "F":   (7, false),
        "Am":  (8, true),                     "C":   (8, false),
        "Em":  (9, true),                     "G":   (9, false),
        "Bm":  (10, true),                    "D":   (10, false),
        "F#m": (11, true), "Gbm": (11, true), "A":   (11, false),
        "Dbm": (12, true), "C#m": (12, true), "E":   (12, false),
    ]
    if let (num, minor) = map[k] {
        return camelotHue(num, isMinor: minor)
    }
    // fallback: strip "m" suffix and retry
    let stripped = k.hasSuffix("m") ? String(k.dropLast()) : k
    if let (num, minor) = map[stripped + "m"] {
        return camelotHue(num, isMinor: minor)
    }
    return Color.secondary
}

private func camelotHue(_ position: Int, isMinor: Bool) -> Color {
    // Camelot positions 1-12 map to hue 0-330° (30° per step)
    let hue = Double(((position - 1) % 12)) / 12.0
    let sat: Double = isMinor ? 0.70 : 0.55
    let bri: Double = isMinor ? 0.65 : 0.72
    return Color(hue: hue, saturation: sat, brightness: bri)
}

private func formatBPM(_ bpm: String) -> String {
    guard let d = Double(bpm) else { return bpm }
    return String(Int(d.rounded()))
}

private func formatDuration(_ seconds: Double) -> String {
    let total = Int(seconds)
    let m = total / 60
    let s = total % 60
    return String(format: "%d:%02d", m, s)
}

private func formatFileSize(_ bytes: Int64) -> String {
    let mb = Double(bytes) / 1_048_576
    if mb >= 100 { return String(format: "%.0f MB", mb) }
    return String(format: "%.1f MB", mb)
}

// MARK: - Tab + Status views

struct FilterTab: View {
    let title: String
    let isSelected: Bool
    let isFirst: Bool
    let isLast: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? .primary : .secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 5)
                .background(isSelected ? Color.white.opacity(0.12) : Color.clear)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .trailing) {
            if !isLast {
                Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1)
            }
        }
    }
}

struct TrackCountRing: View {
    let displayCount:  Int
    let total:         Int
    let problemCount:  Int
    let cleanCount:    Int
    let isScanning:    Bool
    let isBatchRunning: Bool
    let batchProgress: Double

    private let size:      CGFloat = 46
    private let lineWidth: CGFloat = 2.5

    private var cleanFraction:   Double { total > 0 ? Double(cleanCount)   / Double(total) : 0 }
    private var problemFraction: Double { total > 0 ? Double(problemCount) / Double(total) : 0 }

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.18), lineWidth: lineWidth)

            if isScanning {
                ProgressView().progressViewStyle(.circular).scaleEffect(0.55).tint(Color.accentColor)
            } else if isBatchRunning {
                Circle()
                    .trim(from: 0, to: batchProgress)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.25), value: batchProgress)
            } else if total > 0 {
                if cleanFraction > 0 {
                    Circle()
                        .trim(from: 0, to: cleanFraction)
                        .stroke(Color.green.opacity(0.75), style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.5), value: cleanFraction)
                }
                if problemFraction > 0 {
                    Circle()
                        .trim(from: cleanFraction, to: cleanFraction + problemFraction)
                        .stroke(problemFraction > 0.3 ? Color.red.opacity(0.7) : Color.orange.opacity(0.75),
                                style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.5), value: problemFraction)
                }
            }

            VStack(spacing: -1) {
                Text(isScanning ? "…" : "\(displayCount)")
                    .font(.system(size: 12, weight: .bold).monospacedDigit())
                    .foregroundStyle(.primary)
                    .contentTransition(.numericText())
                    .animation(.easeInOut(duration: 0.2), value: displayCount)
                Text("faixas").font(.system(size: 8)).foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
    }
}

struct RowStatusIndicator: View {
    let severity: ProblemSeverity
    let isAnalyzing: Bool

    var body: some View {
        if isAnalyzing {
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.purple)
                .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating)
                .frame(width: 16, height: 16)
        } else {
            Circle().fill(dotColor).frame(width: 8, height: 8)
        }
    }

    private var dotColor: Color {
        switch severity {
        case .none:    return .green
        case .warning: return .orange
        case .error:   return .red
        }
    }
}

struct ProblemDot: View {
    let severity: ProblemSeverity
    var body: some View { RowStatusIndicator(severity: severity, isAnalyzing: false) }
}
