import SwiftUI

// MARK: - AssistantView

struct AssistantView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    @State private var messages: [AssistantMessage] = []
    @State private var inputText: String = ""
    @State private var isThinking: Bool = false
    @FocusState private var inputFocused: Bool

    // Escopo de busca
    @State private var searchScopeURL: URL? = nil
    @State private var scopeTracks: [Track]? = nil
    @State private var isScopeScanning: Bool = false

    private var activeTracks: [Track] { scopeTracks ?? state.tracks }
    private var hasAnyTracks: Bool { !activeTracks.isEmpty }

    private let suggestions = ["Músicas sem BPM", "Faixas com problemas", "Sem álbum", "Sem artista"]

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            scopeBar
            Divider()

            if !hasAnyTracks && !isScopeScanning {
                emptyTracksView
            } else {
                chatArea
                Divider()
                inputBar
            }
        }
        .frame(minWidth: 560, minHeight: 520)
        .onAppear { inputFocused = true }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.title2)
                .foregroundStyle(.purple)

            Text("Assistente Musical")
                .font(.headline)

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Scope Bar

    private var scopeBar: some View {
        HStack(spacing: 10) {
            if isScopeScanning {
                ProgressView().scaleEffect(0.65).frame(width: 16, height: 16)
                Text("Escaneando \(searchScopeURL?.lastPathComponent ?? "")…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            } else if let url = searchScopeURL {
                // Modo pasta personalizada
                Image(systemName: "folder.fill")
                    .font(.caption)
                    .foregroundStyle(.purple)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Buscando em: \(url.lastPathComponent)")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Text("\(activeTracks.count) faixas nessa pasta  •  \(url.deletingLastPathComponent().path)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                Button {
                    pickSearchScope()
                } label: {
                    Label("Outra pasta…", systemImage: "folder.badge.plus")
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .help("Escolher uma pasta diferente para buscar")

                Button {
                    searchScopeURL = nil
                    scopeTracks = nil
                    messages = []
                } label: {
                    Label("Voltar à biblioteca", systemImage: "arrow.uturn.left")
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .foregroundStyle(.secondary)
                .help("Voltar a buscar nas faixas carregadas na janela principal")
            } else {
                // Modo biblioteca
                Image(systemName: state.tracks.isEmpty ? "internaldrive" : "music.note.house.fill")
                    .font(.caption)
                    .foregroundStyle(.purple)
                VStack(alignment: .leading, spacing: 0) {
                    Text(state.tracks.isEmpty ? "Nenhuma pasta carregada" : "Buscando na biblioteca carregada")
                        .font(.caption.weight(.semibold))
                    if !state.tracks.isEmpty {
                        Text("\(state.tracks.count) faixas  •  \(state.selectedFolder?.lastPathComponent ?? "")")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button {
                    pickSearchScope()
                } label: {
                    Label("Buscar em outra pasta…", systemImage: "folder.badge.plus")
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .help("Escolher qualquer pasta ou HD externo para buscar, sem alterar a biblioteca principal")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(searchScopeURL != nil ? Color.purple.opacity(0.06) : Color.clear)
        .animation(.easeInOut(duration: 0.2), value: searchScopeURL == nil)
    }

    // MARK: - Empty tracks

    private var emptyTracksView: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Nenhuma pasta selecionada")
                .font(.title3.weight(.medium))
            Text("Escolha uma pasta ou HD para buscar músicas.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                pickSearchScope()
            } label: {
                Label("Escolher Pasta ou HD…", systemImage: "folder.badge.plus")
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Chat area

    private var chatArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if messages.isEmpty {
                        suggestionChips
                    } else {
                        ForEach(messages) { message in
                            MessageBubble(message: message, onGoTo: { track in
                                // Track já está na biblioteca carregada?
                                if let existing = state.tracks.first(where: { $0.url == track.url }) {
                                    state.selectedTrackIds = [existing.id]
                                    dismiss()
                                } else {
                                    // Track vem de pasta diferente → carrega a pasta e navega
                                    let folder = track.url.deletingLastPathComponent()
                                    state.pendingNavigationURL = track.url
                                    dismiss()
                                    NotificationCenter.default.post(
                                        name: .loadFolderForNavigation,
                                        object: folder
                                    )
                                }
                            })
                            .id(message.id)
                        }

                        if isThinking {
                            thinkingIndicator
                                .id("thinking")
                        }
                    }
                }
                .padding(16)
            }
            .onChange(of: messages.count) {
                withAnimation {
                    if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: isThinking) {
                if isThinking {
                    withAnimation { proxy.scrollTo("thinking", anchor: .bottom) }
                }
            }
        }
    }

    // MARK: - Suggestions

    private var suggestionChips: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .foregroundStyle(.purple)
                    Text("Como posso ajudar?")
                        .font(.headline)
                }
                Text("Busque músicas por nome, artista, gênero, problemas e muito mais.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Sugestões rápidas")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                FlowLayout(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button {
                            sendMessage(suggestion)
                        } label: {
                            Text(suggestion)
                                .font(.callout)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color.purple.opacity(0.1))
                                .foregroundStyle(.purple)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(Color.purple.opacity(0.3), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    // MARK: - Thinking indicator

    private var thinkingIndicator: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.caption)
                .foregroundStyle(.purple)
            ProgressView()
                .scaleEffect(0.7)
                .frame(width: 16, height: 16)
            Text("Buscando…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Input bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Buscar músicas…", text: $inputText)
                .textFieldStyle(.plain)
                .font(.body)
                .focused($inputFocused)
                .onSubmit { sendMessage(inputText) }

            Button {
                sendMessage(inputText)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(inputText.trimmingCharacters(in: .whitespaces).isEmpty ? Color.secondary : Color.purple)
            }
            .buttonStyle(.plain)
            .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isThinking)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: - Send

    private func sendMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        let userMsg = AssistantMessage(role: .user, text: trimmed)
        messages.append(userMsg)
        inputText = ""
        isThinking = true

        let tracks = activeTracks

        Task {
            try? await Task.sleep(nanoseconds: 200_000_000)

            let (response, results) = MusicSearchService.search(query: trimmed, in: tracks)
            let assistantMsg = AssistantMessage(role: .assistant, text: response, results: results.isEmpty ? nil : results)

            await MainActor.run {
                isThinking = false
                messages.append(assistantMsg)
                inputFocused = true
            }
        }
    }

    // MARK: - Scope picker

    private func pickSearchScope() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Buscar aqui"
        panel.message = "Escolha a pasta ou HD onde deseja buscar músicas"
        guard panel.runModal() == .OK, let url = panel.url else { return }

        searchScopeURL = url
        scopeTracks = nil
        isScopeScanning = true
        messages = []

        Task {
            let tracks = try? await TagService.shared.scanFolder(url, recursive: true)
            await MainActor.run {
                scopeTracks = tracks ?? []
                isScopeScanning = false
                inputFocused = true
            }
        }
    }
}

// MARK: - MessageBubble

private struct MessageBubble: View {
    let message: AssistantMessage
    let onGoTo: (Track) -> Void

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
            HStack {
                if message.role == .user { Spacer(minLength: 60) }

                Text(message.text)
                    .font(.callout)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        message.role == .user
                            ? Color.accentColor
                            : Color(nsColor: .controlBackgroundColor)
                    )
                    .foregroundStyle(message.role == .user ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                if message.role == .assistant { Spacer(minLength: 60) }
            }

            if message.role == .assistant, let results = message.results, !results.isEmpty {
                VStack(spacing: 8) {
                    ForEach(results) { track in
                        TrackResultCard(track: track, onGoTo: { onGoTo(track) })
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}

// MARK: - TrackResultCard

private struct TrackResultCard: View {
    let track: Track
    let onGoTo: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Music note icon
            Image(systemName: "music.note")
                .font(.title3)
                .foregroundStyle(.purple)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                // Title
                Text(track.title.isEmpty ? "(sem título)" : track.title)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)

                // Artist
                if !track.artist.isEmpty {
                    Text(track.artist)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                // Full path
                Text(track.url.path)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
                    .truncationMode(.middle)

                // BPM + Key chips
                HStack(spacing: 6) {
                    if !track.bpm.isEmpty {
                        chip(label: "BPM \(track.bpm)", color: .blue)
                    }
                    if !track.key.isEmpty {
                        chip(label: track.key, color: .green)
                    }
                    if track.hasProblems {
                        chip(label: "Problemas", color: .orange)
                    }
                }
            }

            Spacer()

            Button("Ir para") {
                onGoTo()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.mini)
            .tint(.purple)
        }
        .padding(12)
        .background(Color(nsColor: .windowBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.15), lineWidth: 1))
    }

    private func chip(label: String, color: Color) -> some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

// FlowLayout is defined in DJValidationSheet.swift
