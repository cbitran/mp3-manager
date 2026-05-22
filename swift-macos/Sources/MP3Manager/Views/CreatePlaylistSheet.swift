import SwiftUI

struct CreatePlaylistSheet: View {
    let tracks: [Track]
    @Environment(\.dismiss) private var dismiss

    @State private var playlistName = ""
    @State private var destinationURL: URL?
    @State private var moveFiles = false
    @State private var createM3U = true
    @State private var isCreating = false
    @State private var resultMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Criar Playlist", systemImage: "music.note.list")
                        .font(.title3.bold())
                    Text("\(tracks.count) faixa\(tracks.count == 1 ? "" : "s") selecionada\(tracks.count == 1 ? "" : "s")")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }

            Divider()

            // Nome
            VStack(alignment: .leading, spacing: 4) {
                Text("Nome da playlist").font(.caption2.bold()).foregroundStyle(.secondary)
                TextField("Ex: Sertanejo 2024, House Favorites…", text: $playlistName)
                    .textFieldStyle(.roundedBorder)
                    .font(.callout)
            }

            // Destino
            VStack(alignment: .leading, spacing: 6) {
                Text("Pasta destino").font(.caption2.bold()).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Group {
                        if let url = destinationURL {
                            HStack(spacing: 6) {
                                Image(systemName: "folder.fill").foregroundStyle(.secondary)
                                Text(url.path)
                                    .font(.callout)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        } else {
                            Text("Nenhuma pasta selecionada")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Escolher…") { pickFolder() }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                .padding(8)
                .background(.fill.tertiary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Opções
            VStack(alignment: .leading, spacing: 10) {
                Text("Opções").font(.caption2.bold()).foregroundStyle(.secondary)
                Toggle(isOn: $moveFiles) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Mover arquivos").font(.callout)
                        Text("Remove os MP3s da pasta original após copiar")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Toggle(isOn: $createM3U) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Criar arquivo .m3u").font(.callout)
                        Text("Lista de reprodução compatível com players de DJ")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if let msg = resultMessage {
                Text(msg)
                    .font(.callout)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(msg.hasPrefix("✓") ? Color.green.opacity(0.1) : Color.red.opacity(0.1))
                    )
            }

            Spacer(minLength: 0)
            Divider()

            HStack {
                Button("Cancelar") { dismiss() }.buttonStyle(.bordered)
                Spacer()
                Button {
                    createPlaylist()
                } label: {
                    Label(
                        isCreating ? "Criando…" : (moveFiles ? "Mover para Playlist" : "Copiar para Playlist"),
                        systemImage: isCreating ? "hourglass" : (moveFiles ? "arrow.right.doc.on.clipboard" : "doc.on.doc")
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(playlistName.trimmingCharacters(in: .whitespaces).isEmpty
                          || destinationURL == nil
                          || isCreating)
            }
        }
        .padding(24)
        .frame(width: 440, height: 530)
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Escolher Pasta"
        panel.message = "A playlist será criada como uma subpasta dentro desta pasta"
        if panel.runModal() == .OK { destinationURL = panel.url }
    }

    private func createPlaylist() {
        guard let baseURL = destinationURL else { return }
        let name = playlistName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        isCreating = true
        resultMessage = nil

        Task {
            do {
                let fm = FileManager.default
                let folderURL = baseURL.appendingPathComponent(name)
                try fm.createDirectory(at: folderURL, withIntermediateDirectories: true)

                var m3uLines = ["#EXTM3U", ""]
                var successCount = 0

                for track in tracks {
                    let dest = folderURL.appendingPathComponent(track.url.lastPathComponent)
                    do {
                        if moveFiles {
                            if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
                            try fm.moveItem(at: track.url, to: dest)
                        } else {
                            try fm.copyItem(at: track.url, to: dest)
                        }
                        let artistTitle = [track.artist, track.title]
                            .filter { !$0.isEmpty }.joined(separator: " - ")
                        m3uLines.append("#EXTINF:\(Int(track.duration)),\(artistTitle)")
                        m3uLines.append(track.url.lastPathComponent)
                        successCount += 1
                    } catch { }
                }

                if createM3U && successCount > 0 {
                    let m3uURL = folderURL.appendingPathComponent("\(name).m3u")
                    try m3uLines.joined(separator: "\n")
                        .write(to: m3uURL, atomically: true, encoding: .utf8)
                }

                let failed = tracks.count - successCount
                await MainActor.run {
                    isCreating = false
                    if failed == 0 {
                        resultMessage = "✓ Playlist \"\(name)\" criada com \(successCount) faixa\(successCount == 1 ? "" : "s")"
                        Task {
                            try? await Task.sleep(for: .seconds(1.8))
                            await MainActor.run { dismiss() }
                        }
                    } else {
                        resultMessage = "✓ \(successCount) faixas copiadas · \(failed) não puderam ser copiadas"
                    }
                }
            } catch {
                await MainActor.run {
                    isCreating = false
                    resultMessage = "✗ Erro: \(error.localizedDescription)"
                }
            }
        }
    }
}
