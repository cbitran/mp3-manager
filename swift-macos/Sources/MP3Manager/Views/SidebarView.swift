import SwiftUI

struct SidebarView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            statsSection
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !state.favoriteFolders.isEmpty {
                        folderSection(
                            title: "FAVORITOS",
                            folders: state.favoriteFolders,
                            icon: "star.fill",
                            iconColor: .yellow
                        )
                        Divider().padding(.horizontal, 12).padding(.vertical, 4)
                    }
                    if !state.recentFolders.isEmpty {
                        folderSection(
                            title: "RECENTES",
                            folders: state.recentFolders,
                            icon: "folder",
                            iconColor: .secondary
                        )
                    }
                }
            }
            Spacer(minLength: 0)
            Text(state.statusMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("MP3 Manager")
        .navigationSplitViewColumnWidth(min: 200, ideal: 220)
    }

    // MARK: - Stats

    @ViewBuilder
    private var statsSection: some View {
        if let folder = state.selectedFolder {
            VStack(alignment: .leading, spacing: 8) {
                Label(folder.lastPathComponent, systemImage: "folder.fill")
                    .font(.headline)
                    .lineLimit(1)
                HStack(spacing: 12) {
                    StatBadge(value: state.tracks.count, label: "músicas", color: .secondary)
                    StatBadge(value: state.problemTracks.count, label: "problemas",
                              color: state.problemTracks.isEmpty ? .green : .orange)
                }
            }
            .padding()
        } else {
            VStack(spacing: 12) {
                Image(systemName: "music.note.list")
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                Text("Nenhuma pasta aberta")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    // MARK: - Folder list

    @ViewBuilder
    private func folderSection(title: String, folders: [URL], icon: String, iconColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 2)

            ForEach(folders, id: \.self) { url in
                folderRow(url: url, icon: icon, iconColor: iconColor)
            }
        }
        .padding(.bottom, 4)
    }

    private func folderRow(url: URL, icon: String, iconColor: Color) -> some View {
        Button {
            Task { await openFolder(url) }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundStyle(iconColor == .secondary ? .secondary : iconColor)
                Text(url.lastPathComponent)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                state.selectedFolder == url
                    ? Color.accentColor.opacity(0.15)
                    : Color.clear
            )
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                Task { await openFolder(url) }
            } label: {
                Label("Abrir", systemImage: "folder.badge.arrow.right")
            }

            Divider()

            Button {
                state.toggleFavorite(url)
            } label: {
                Label(
                    state.isFavorite(url) ? "Remover dos Favoritos" : "Adicionar aos Favoritos",
                    systemImage: state.isFavorite(url) ? "star.slash" : "star"
                )
            }

            Button(role: .destructive) {
                let folderPath = url.path
                state.tracks.removeAll { $0.url.path.hasPrefix(folderPath) }
                state.selectedTrackIds.removeAll()
                if state.selectedFolder == url {
                    state.selectedFolder = nil
                    // Para o scan se estiver rodando para esta pasta
                    state.isScanning  = false
                    state.scanDone    = 0
                    state.scanTotal   = 0
                    state.scanProgress = 0
                    state.statusMessage = "Pronto"
                }
                state.removeRecentFolder(url)
                if state.isFavorite(url) { state.toggleFavorite(url) }
            } label: {
                Label("Remover da Lista", systemImage: "xmark")
            }

            Divider()

            Button {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } label: {
                Label("Mostrar no Finder", systemImage: "magnifyingglass")
            }
        }
    }

    // MARK: - Open

    private func openFolder(_ url: URL) async {
        guard FileManager.default.fileExists(atPath: url.path) else {
            state.statusMessage = "Pasta não encontrada: \(url.lastPathComponent)"
            return
        }
        state.selectedFolder = url
        state.selectedTrackId = nil
        state.isScanning = true
        state.tracks = []
        state.scanDone = 0
        state.scanTotal = 0
        state.scanProgress = 0
        state.statusMessage = "Escaneando \(url.lastPathComponent)…"
        state.addRecentFolder(url)

        do {
            let tracks = try await TagService.shared.scanFolder(url) { @MainActor track, done, total in
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
            if state.tracks.count != tracks.count { state.tracks = tracks }
            state.scanProgress = 1.0
            let p = tracks.filter { $0.hasProblems }.count
            state.statusMessage = "\(tracks.count) músicas • \(p) com problemas"
        } catch {
            if state.selectedFolder == url {
                state.statusMessage = "Erro: \(error.localizedDescription)"
            }
        }

        state.isScanning = false
    }
}

// MARK: - StatBadge

struct StatBadge: View {
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
