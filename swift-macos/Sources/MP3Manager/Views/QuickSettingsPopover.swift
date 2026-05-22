import SwiftUI

struct QuickSettingsPopover: View {
    @Environment(AppState.self) private var state
    @AppStorage("appColorScheme") private var colorScheme: String = "auto"
    @State private var showPathPicker = false

    var body: some View {
        @Bindable var state = state
        VStack(alignment: .leading, spacing: 0) {
            header

            Divider()

            librarySection

            Divider()

            appearanceSection

            Divider()

            footer
        }
        .frame(width: 300)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Label("Configurações Rápidas", systemImage: "gear")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Spacer()
            Button("Todas as Configurações") {
                if let url = URL(string: "x-apple.systempreferences:") {
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                    _ = url
                }
            }
            .buttonStyle(.plain)
            .font(.caption2)
            .foregroundStyle(Color.accentColor)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: - Library Section

    private var librarySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Biblioteca Global", systemImage: "music.note.house")
                .font(.callout.bold())

            Text("Pasta raiz com todas as suas músicas. Permite busca em toda a biblioteca, independente da pasta aberta.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                if state.libraryRootPath.isEmpty {
                    Text("Nenhuma pasta definida")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Text(URL(fileURLWithPath: state.libraryRootPath).lastPathComponent)
                        .font(.caption)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        state.libraryRootPath = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.plain)
                }

                Button(state.libraryRootPath.isEmpty ? "Escolher…" : "Trocar") {
                    pickLibraryPath()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if !state.libraryRootPath.isEmpty {
                if state.isIndexingLibrary {
                    HStack(spacing: 6) {
                        ProgressView().scaleEffect(0.65)
                        Text("Indexando \(state.libraryIndexDone)/\(state.libraryIndexTotal > 0 ? "\(state.libraryIndexTotal)" : "?")…")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } else if state.libraryTracks.isEmpty {
                    Button {
                        Task { await indexLibrary() }
                    } label: {
                        Label("Indexar biblioteca (\(shortPath))", systemImage: "arrow.clockwise")
                            .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("\(state.libraryTracks.count) faixas indexadas")
                            .font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Button("Atualizar") { Task { await indexLibrary() } }
                            .buttonStyle(.plain).font(.caption2).foregroundStyle(Color.accentColor)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Appearance Section

    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Tema", systemImage: "circle.lefthalf.filled")
                .font(.callout.bold())

            Picker("", selection: $colorScheme) {
                Label("Auto",   systemImage: "circle.lefthalf.filled").tag("auto")
                Label("Claro",  systemImage: "sun.max.fill").tag("light")
                Label("Escuro", systemImage: "moon.fill").tag("dark")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Spacer()
            Button("Abrir Configurações Completas") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Spacer()
        }
        .padding(.vertical, 10)
    }

    // MARK: - Helpers

    private var shortPath: String {
        let url = URL(fileURLWithPath: state.libraryRootPath)
        return url.lastPathComponent
    }

    private func pickLibraryPath() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Usar esta pasta"
        panel.message = "Selecione a pasta raiz com todas as suas músicas"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        state.libraryRootPath = url.path
    }

    @MainActor
    private func indexLibrary() async {
        guard !state.libraryRootPath.isEmpty else { return }
        let url = URL(fileURLWithPath: state.libraryRootPath)
        state.isIndexingLibrary = true
        state.libraryIndexDone = 0
        state.libraryIndexTotal = 0
        state.libraryTracks = []
        do {
            let tracks = try await TagService.shared.scanFolder(url, recursive: true) { @MainActor _, done, total in
                state.libraryIndexDone = done
                state.libraryIndexTotal = total
            }
            state.libraryTracks = tracks
        } catch {}
        state.isIndexingLibrary = false
    }
}
