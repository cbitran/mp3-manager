import SwiftUI

struct DuplicatesView: View {
    @Environment(AppState.self) private var state
    @State private var filterReason: FilterReason = .all
    @State private var keepSelections: [DuplicateGroup.ID: Track.ID] = [:]

    enum FilterReason: String, CaseIterable {
        case all       = "Todas"
        case exactFile = "Idênticas"
        case similar   = "Similares"
    }

    private var filtered: [DuplicateGroup] {
        switch filterReason {
        case .all:       return state.duplicateGroups
        case .exactFile: return state.duplicateGroups.filter { $0.reason == .exactFile }
        case .similar:   return state.duplicateGroups.filter { $0.reason == .similarMeta }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if state.isDuplicateScanning {
                scanningPlaceholder
            } else if state.duplicateGroups.isEmpty {
                emptyState
            } else {
                filterBar
                Divider()
                groupList
            }
        }
        .frame(minWidth: 680, idealWidth: 740, minHeight: 520, idealHeight: 620)
        .onAppear {
            for group in state.duplicateGroups {
                if keepSelections[group.id] == nil {
                    keepSelections[group.id] = group.suggestedKeepId
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Label("Duplicatas Detectadas", systemImage: "doc.on.doc.fill")
                .font(.title3.bold())

            Spacer()

            if !state.duplicateGroups.isEmpty {
                Text("\(state.duplicateGroups.count) grupo\(state.duplicateGroups.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }

            Button("Fechar") { state.isShowingDuplicates = false }
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack {
            Picker("", selection: $filterReason) {
                ForEach(FilterReason.allCases, id: \.self) { mode in
                    Text(label(mode)).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 320)

            Spacer()

            Text("Selecione qual manter (✓) e descarte as demais")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }

    private func label(_ mode: FilterReason) -> String {
        switch mode {
        case .all:
            let c = state.duplicateGroups.count
            return c > 0 ? "Todas  \(c)" : "Todas"
        case .exactFile:
            let c = state.duplicateGroups.filter { $0.reason == .exactFile }.count
            return c > 0 ? "Idênticas  \(c)" : "Idênticas"
        case .similar:
            let c = state.duplicateGroups.filter { $0.reason == .similarMeta }.count
            return c > 0 ? "Similares  \(c)" : "Similares"
        }
    }

    // MARK: - Group List

    private var groupList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(filtered) { group in
                    DuplicateGroupRow(
                        group: group,
                        keepId: Binding(
                            get: { keepSelections[group.id] ?? group.suggestedKeepId },
                            set: { keepSelections[group.id] = $0 }
                        ),
                        onTrashOthers: { trashNonKept(in: group) },
                        onIgnore: { state.duplicateGroups.resolveGroup(group.id) }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Placeholders

    private var scanningPlaceholder: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Analisando duplicatas…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "Nenhuma duplicata encontrada",
            systemImage: "checkmark.circle.fill",
            description: Text("Todas as faixas na biblioteca são únicas.")
        )
    }

    // MARK: - Actions

    private func trashNonKept(in group: DuplicateGroup) {
        let keepId = keepSelections[group.id] ?? group.suggestedKeepId
        let toTrash = group.tracks.filter { $0.id != keepId }

        for track in toTrash {
            do {
                try FileManager.default.trashItem(at: track.url, resultingItemURL: nil)
                state.tracks.removeAll { $0.id == track.id }
            } catch {
                // silently skip if trash fails
            }
        }
        state.duplicateGroups.resolveGroup(group.id)

        let p = state.tracks.filter { $0.hasProblems }.count
        state.statusMessage = "\(state.tracks.count) músicas • \(p) com problemas"
    }
}

// MARK: - DuplicateGroupRow

struct DuplicateGroupRow: View {
    let group: DuplicateGroup
    @Binding var keepId: Track.ID?
    let onTrashOthers: () -> Void
    let onIgnore: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Group header
            HStack(spacing: 8) {
                Image(systemName: group.reason.icon)
                    .foregroundStyle(group.reason.color)
                    .font(.system(size: 12, weight: .semibold))

                Text(group.reason.label)
                    .font(.caption.bold())
                    .foregroundStyle(group.reason.color)

                Text("• \(group.tracks.count) arquivos")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Ignorar grupo") { onIgnore() }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .foregroundStyle(.secondary)

                Button {
                    onTrashOthers()
                } label: {
                    Label("Mover para Lixeira", systemImage: "trash")
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .controlSize(.mini)
                .disabled(keepId == nil)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(group.reason.color.opacity(0.06))

            Divider()

            // Track rows
            ForEach(group.tracks) { track in
                TrackDuplicateRow(
                    track: track,
                    isKept: keepId == track.id,
                    onToggle: {
                        keepId = (keepId == track.id) ? nil : track.id
                    }
                )
                if track.id != group.tracks.last?.id { Divider().padding(.leading, 42) }
            }
        }
        .background(.background.secondary)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(group.reason.color.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - TrackDuplicateRow

struct TrackDuplicateRow: View {
    let track: Track
    let isKept: Bool
    let onToggle: () -> Void

    private var fileSize: String {
        guard let size = try? track.url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return "" }
        let mb = Double(size) / 1_048_576
        return String(format: "%.1f MB", mb)
    }

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onToggle) {
                Image(systemName: isKept ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(isKept ? .green : .secondary.opacity(0.5))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(track.title.isEmpty ? track.filename : track.title)
                    .font(.callout.weight(isKept ? .medium : .regular))
                    .foregroundStyle(isKept ? .primary : .secondary)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    if !track.artist.isEmpty {
                        Text(track.artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !fileSize.isEmpty {
                        Text("•")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text(fileSize)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            Text(track.url.deletingLastPathComponent().path)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 220)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(isKept ? Color.green.opacity(0.04) : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture { onToggle() }
    }
}
