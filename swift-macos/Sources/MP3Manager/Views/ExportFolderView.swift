import SwiftUI

struct ExportFolderView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss
    let tracks: [Track]

    @State private var destinationURL: URL?
    @State private var copyMode = true
    @State private var groupBy: FolderOrganizer.GroupBy = .flat
    @State private var isExporting = false
    @State private var progress = 0
    @State private var summary: FolderOrganizer.Summary?
    @State private var exportError: String?

    private var previewFolders: [(folder: String, count: Int)] {
        FolderOrganizer.preview(tracks: tracks, groupBy: groupBy)
    }

    private var missingCount: Int {
        switch groupBy {
        case .flat:     return 0
        case .genre:    return tracks.filter { $0.genre.trimmingCharacters(in: .whitespaces).isEmpty }.count
        case .artist:   return tracks.filter { $0.artist.trimmingCharacters(in: .whitespaces).isEmpty }.count
        case .decade:   return tracks.filter { Int($0.year.prefix(4)) == nil }.count
        case .bpmRange: return tracks.filter { Double($0.bpm) == nil }.count
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if let summary = summary {
                resultView(summary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        destinationSection
                        Divider()
                        operationSection
                        Divider()
                        organizationSection
                        Divider()
                        previewSection
                    }
                    .padding(20)
                }
                Divider()
                footer
            }
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 540, idealHeight: 620)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Label("Exportar para Pasta", systemImage: "arrow.up.doc.on.clipboard")
                .font(.title3.bold())
            Spacer()
            Text("\(tracks.count) faixa\(tracks.count == 1 ? "" : "s")")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(.quaternary).clipShape(Capsule())
            Button("Fechar") { dismiss() }
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    // MARK: - Destination

    private var destinationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Pasta de destino", icon: "folder.fill")
            HStack(spacing: 10) {
                Button("Escolher Pasta…") { pickDestination() }
                    .buttonStyle(.bordered)
                if let url = destinationURL {
                    Text(url.path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Text("Nenhuma pasta selecionada")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    // MARK: - Operation

    private var operationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Operação", icon: "arrow.right.doc.on.clipboard")

            HStack(spacing: 16) {
                operationButton(label: "Copiar", subtitle: "Mantém os originais", selected: copyMode) {
                    copyMode = true
                }
                operationButton(label: "Mover", subtitle: "Remove dos locais originais", selected: !copyMode, tint: .orange) {
                    copyMode = false
                }
            }

            if !copyMode {
                Label("Os arquivos originais serão removidos. Esta ação não pode ser desfeita.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private func operationButton(label: String, subtitle: String, selected: Bool, tint: Color = .accentColor, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? tint : .secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.callout.weight(selected ? .semibold : .regular))
                        .foregroundStyle(selected ? tint : .primary)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(selected ? tint.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? tint.opacity(0.3) : Color.secondary.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Organization

    private var organizationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Organização", icon: "square.grid.2x2")
            Picker("", selection: $groupBy) {
                ForEach(FolderOrganizer.GroupBy.allCases) { option in
                    Label(option.rawValue, systemImage: option.icon).tag(option)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 280)
        }
    }

    // MARK: - Preview

    private var previewSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Prévia de subpastas", icon: "list.bullet.indent")

            if groupBy == .flat {
                Text("Todos os arquivos na mesma pasta, sem subpastas.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(previewFolders.prefix(10), id: \.folder) { item in
                        HStack(spacing: 6) {
                            Image(systemName: "folder")
                                .font(.caption2).foregroundStyle(.secondary)
                            Text(item.folder)
                                .font(.caption)
                            Spacer()
                            Text("\(item.count) faixa\(item.count == 1 ? "" : "s")")
                                .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    if previewFolders.count > 10 {
                        Text("… e mais \(previewFolders.count - 10) pasta\(previewFolders.count - 10 == 1 ? "" : "s")")
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                .padding(10)
                .background(.quaternary)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                if missingCount > 0 {
                    Label(
                        "\(missingCount) faixa\(missingCount == 1 ? "" : "s") sem \(missingFieldName) \(missingCount == 1 ? "sera agrupada" : "serao agrupadas") em \"\(missingFolderName)\".",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.caption2)
                    .foregroundStyle(.orange)
                }
            }
        }
    }

    private var missingFieldName: String {
        switch groupBy {
        case .flat: return ""
        case .genre: return "gênero"
        case .artist: return "artista"
        case .decade: return "ano"
        case .bpmRange: return "BPM"
        }
    }

    private var missingFolderName: String {
        switch groupBy {
        case .flat: return ""
        case .genre: return "Sem Gênero"
        case .artist: return "Artista Desconhecido"
        case .decade: return "Ano Desconhecido"
        case .bpmRange: return "BPM Desconhecido"
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            if isExporting {
                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.7)
                    Text("Exportando… \(progress)/\(tracks.count)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if let err = exportError {
                Text(err).font(.caption).foregroundStyle(.red)
            }
            Spacer()
            Button("Exportar \(tracks.count) faixa\(tracks.count == 1 ? "" : "s")") {
                startExport()
            }
            .buttonStyle(.borderedProminent)
            .disabled(destinationURL == nil || isExporting)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    // MARK: - Result

    private func resultView(_ s: FolderOrganizer.Summary) -> some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)

            VStack(spacing: 6) {
                if s.copied > 0 { Text("✓ \(s.copied) faixa\(s.copied == 1 ? "" : "s") copiada\(s.copied == 1 ? "" : "s")").font(.callout) }
                if s.moved  > 0 { Text("✓ \(s.moved) faixa\(s.moved == 1 ? "" : "s") movida\(s.moved == 1 ? "" : "s")").font(.callout) }
                if !s.foldersCreated.isEmpty {
                    Text("\(s.foldersCreated.count) subpasta\(s.foldersCreated.count == 1 ? "" : "s") criada\(s.foldersCreated.count == 1 ? "" : "s")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if s.skipped > 0 {
                    Text("\(s.skipped) ignorada\(s.skipped == 1 ? "" : "s") (já existia no destino)")
                        .font(.caption).foregroundStyle(.orange)
                }
                if s.errors > 0 {
                    Text("\(s.errors) erro\(s.errors == 1 ? "" : "s") ao copiar/mover")
                        .font(.caption).foregroundStyle(.red)
                }
            }

            Button("Fechar") { dismiss() }
                .buttonStyle(.borderedProminent)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func pickDestination() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Escolher Destino"
        panel.message = "Selecione a pasta onde as músicas serão exportadas"
        if panel.runModal() == .OK { destinationURL = panel.url }
    }

    private func startExport() {
        guard let dest = destinationURL else { return }
        isExporting = true
        exportError = nil
        progress = 0

        Task {
            do {
                let (result, movedURLs) = try await FolderOrganizer.organize(
                    tracks: tracks,
                    to: dest,
                    groupBy: groupBy,
                    copy: copyMode,
                    progress: { n in Task { @MainActor in progress = n } }
                )
                await MainActor.run {
                    // If moved, remove tracks that were relocated
                    if !copyMode {
                        for (id, newURL) in movedURLs {
                            if var t = state.tracks.first(where: { $0.id == id }) {
                                t.url = newURL
                                state.updateTrack(t)
                            }
                        }
                        let p = state.tracks.filter { $0.hasProblems }.count
                        state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
                    }
                    summary = result
                    isExporting = false
                }
            } catch {
                await MainActor.run {
                    exportError = "Erro: \(error.localizedDescription)"
                    isExporting = false
                }
            }
        }
    }
}
