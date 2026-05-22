import SwiftUI

struct MetadataCaptureView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    let tracks: [Track]

    @State private var results: [PipelineResult] = []
    @State private var isRunning = false
    @State private var done = 0
    @State private var total = 0
    @State private var saved = false

    private var highConfidence: [PipelineResult] {
        results.filter { $0.status == .found && $0.apply }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Capturar Metadados")
                        .font(.title3).fontWeight(.semibold)
                    Text("\(tracks.count) faixa\(tracks.count == 1 ? "" : "s") • 5 fontes em sequência")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if isRunning {
                    ProgressView(value: Double(done), total: Double(max(total, 1)))
                        .frame(width: 120)
                    Text("\(done)/\(total)")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .padding()

            // Pipeline legend
            HStack(spacing: 12) {
                ForEach([
                    ("doc.text",        "Filename",    Color.blue),
                    ("music.note.list", "MusicBrainz", Color.teal),
                    ("waveform",        "AcoustID",    Color.purple),
                    ("waveform.circle.fill", "Spotify", Color.green),
                    ("tag.circle.fill", "Last.fm",     Color.orange),
                ], id: \.1) { icon, label, color in
                    HStack(spacing: 4) {
                        Image(systemName: icon).foregroundStyle(color).font(.caption)
                        Text(label).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if !results.isEmpty {
                    let found = results.filter { $0.status == .found || $0.status == .lowConfidence }.count
                    Text("\(found) encontrados")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)

            Divider()

            // Results list
            if results.isEmpty && !isRunning {
                emptyState
            } else {
                List(results) { result in
                    PipelineResultRow(result: result, onToggle: { toggle(id: result.id) })
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
                .listStyle(.plain)
            }

            Divider()

            // Footer
            HStack {
                if !results.isEmpty {
                    Text("\(highConfidence.count) para aplicar")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Cancelar") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                if results.isEmpty {
                    Button("Iniciar Pipeline") {
                        Task { await runPipeline() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                } else if !isRunning {
                    Button(saved ? "Aplicado ✓" : "Aplicar \(highConfidence.count) faixas") {
                        applyResults()
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(highConfidence.isEmpty || saved)
                }
            }
            .padding()
        }
        .frame(minWidth: 680, minHeight: 500)
        .task { await runPipeline() }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Pronto para iniciar", systemImage: "sparkles")
        } description: {
            Text("O pipeline vai tentar identificar cada faixa em 3 etapas:\nnome do arquivo → MusicBrainz → AcoustID")
        }
    }

    // MARK: - Pipeline

    @MainActor
    private func runPipeline() async {
        guard !isRunning else { return }
        isRunning = true
        done = 0
        total = tracks.count
        results = tracks.map { PipelineResult(track: $0, status: .pending) }

        await MetadataPipelineService.shared.run(tracks: tracks) { result in
            await MainActor.run {
                if let idx = results.firstIndex(where: { $0.id == result.id }) {
                    results[idx] = result
                }
                done = results.filter { $0.status != .pending && $0.status != .running }.count
            }
        }

        isRunning = false
    }

    // MARK: - Apply

    private func applyResults() {
        let toApply = highConfidence
        var updatedTracks = state.tracks

        for result in toApply {
            guard let match = result.match,
                  let idx = updatedTracks.firstIndex(where: { $0.id == result.track.id }) else { continue }

            var t = updatedTracks[idx]
            if !match.title.isEmpty  { t.title  = match.title }
            if !match.artist.isEmpty { t.artist = match.artist }
            if !match.album.isEmpty  { t.album  = match.album }
            if !match.genre.isEmpty  { t.genre  = match.genre }
            if !match.year.isEmpty   { t.year   = match.year }
            if !match.bpm.isEmpty    { t.bpm    = match.bpm }
            if !match.key.isEmpty    { t.key    = match.key }

            ValidationService.revalidate(&t)
            updatedTracks[idx] = t

            Task {
                try? await TagWriter.shared.writeTags(to: updatedTracks[idx])
            }
        }

        state.tracks = updatedTracks
        saved = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { dismiss() }
    }

    private func toggle(id: UUID) {
        if let idx = results.firstIndex(where: { $0.id == id }) {
            results[idx].apply.toggle()
        }
    }
}

// MARK: - ResultRow

private struct PipelineResultRow: View {
    let result: PipelineResult
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Status icon
            statusIcon

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(result.track.filename)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    if result.status != .pending && result.status != .running {
                        sourceBadge
                    }
                }

                if let match = result.match {
                    HStack(spacing: 6) {
                        if !match.title.isEmpty {
                            chip(match.title, color: .primary)
                        }
                        if !match.artist.isEmpty {
                            chip(match.artist, color: .blue)
                        }
                        if !match.genre.isEmpty {
                            chip(match.genre, color: .teal)
                        }
                        if !match.year.isEmpty {
                            chip(match.year, color: .secondary)
                        }
                        Spacer()
                        Text("\(match.score)%")
                            .font(.caption2)
                            .foregroundStyle(match.score >= 75 ? .green : .orange)
                            .monospacedDigit()
                    }
                } else if result.status == .notFound {
                    Text("Não encontrado nas 3 fontes")
                        .font(.caption).foregroundStyle(.tertiary)
                } else if result.status == .pending {
                    Text("Aguardando…")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }

            if result.status == .found || result.status == .lowConfidence {
                Toggle("", isOn: Binding(
                    get: { result.apply },
                    set: { _ in onToggle() }
                ))
                .toggleStyle(.checkbox)
                .labelsHidden()
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var statusIcon: some View {
        switch result.status {
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(.quaternary)
                .frame(width: 16)
        case .running:
            ProgressView().scaleEffect(0.55).frame(width: 16)
        case .found:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .frame(width: 16)
        case .lowConfidence:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.orange)
                .frame(width: 16)
        case .notFound:
            Image(systemName: "xmark.circle")
                .foregroundStyle(.quaternary)
                .frame(width: 16)
        }
    }

    @ViewBuilder private var sourceBadge: some View {
        let (label, color): (String, Color) = switch result.step {
        case .filename:    ("Filename",  .blue)
        case .musicBrainz: ("MB",        .teal)
        case .acoustID:    ("AcoustID",  .purple)
        case .spotify:     ("Spotify",   .green)
        case .lastFM:      ("Last.fm",   .orange)
        case .notFound:    ("—",         .secondary)
        }

        Text(label)
            .font(.system(size: 9, weight: .semibold))
            .padding(.horizontal, 5).padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func chip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}
