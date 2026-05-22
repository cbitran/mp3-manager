import SwiftUI

struct FilenameTagSheet: View {
    var candidates: [FilenameTagCandidate]
    var onApply: ([FilenameTagCandidate]) -> Void
    var onSkip: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var items: [FilenameTagCandidate]
    @State private var overwrite: Bool = false

    init(candidates: [FilenameTagCandidate],
         onApply: @escaping ([FilenameTagCandidate]) -> Void,
         onSkip: @escaping () -> Void) {
        self.candidates = candidates
        self.onApply   = onApply
        self.onSkip    = onSkip
        _items = State(initialValue: candidates)
    }

    private var selectedCount: Int { items.filter { $0.isSelected }.count }
    private var allSelected: Bool  { items.allSatisfy { $0.isSelected } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            controls
            Divider()
            ScrollView {
                VStack(spacing: 0) {
                    ForEach($items) { $item in
                        CandidateRow(item: $item, overwrite: overwrite)
                        Divider().padding(.leading, 44)
                    }
                }
            }
            .frame(maxHeight: 320)
            Divider()
            footer
        }
        .frame(width: 520)
        .fixedSize(horizontal: true, vertical: false)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.14))
                    .frame(width: 44, height: 44)
                Image(systemName: "doc.badge.plus")
                    .font(.title3)
                    .foregroundStyle(Color.orange)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Popular tags a partir dos nomes de arquivo?")
                    .font(.title3.bold())
                Text("\(candidates.count) arquivo\(candidates.count == 1 ? "" : "s") sem tags com nome identificável")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(spacing: 16) {
            // Select all toggle
            Button {
                let newVal = !allSelected
                for i in items.indices { items[i].isSelected = newVal }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: allSelected ? "checkmark.square.fill" : "square")
                        .foregroundStyle(allSelected ? Color.blue : .secondary)
                    Text(allSelected ? "Desselecionar todos" : "Selecionar todos")
                        .font(.caption)
                }
            }
            .buttonStyle(.plain)

            Spacer()

            Toggle(isOn: $overwrite) {
                Text("Sobrescrever tags existentes")
                    .font(.caption)
            }
            .toggleStyle(.checkbox)
            .help("Aplica mesmo quando a tag já tem algum valor")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Button("Pular") {
                onSkip()
                dismiss()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)

            Spacer()

            Button("Pular por agora") {
                onSkip()
                dismiss()
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.escape)

            Button {
                let selected = items.filter { $0.isSelected }
                onApply(selected)
                dismiss()
            } label: {
                Label("Popular \(selectedCount) faixa\(selectedCount == 1 ? "" : "s")",
                      systemImage: "tag.fill")
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return)
            .disabled(selectedCount == 0)
        }
        .padding(20)
    }
}

// MARK: - Candidate Row

struct CandidateRow: View {
    @Binding var item: FilenameTagCandidate
    let overwrite: Bool

    private var parsedArtist: String { item.parsed.artist }
    private var parsedTitle:  String { item.parsed.title }
    private var willApplyArtist: Bool { !parsedArtist.isEmpty && (item.track.artist.isEmpty || overwrite) }
    private var willApplyTitle:  Bool { !parsedTitle.isEmpty  && (item.track.title.isEmpty  || overwrite) }
    private var trackNumber: String   { item.parsed.trackNumber }

    var body: some View {
        HStack(spacing: 10) {
            Toggle("", isOn: $item.isSelected)
                .toggleStyle(.checkbox)
                .labelsHidden()
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.track.filename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: 200, alignment: .leading)

            Image(systemName: "arrow.right")
                .font(.caption2)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                if willApplyArtist {
                    TagPreviewChip(label: "Artista", value: parsedArtist, color: .blue)
                }
                if willApplyTitle {
                    TagPreviewChip(label: "Título", value: parsedTitle, color: .green)
                }
                if !trackNumber.isEmpty {
                    TagPreviewChip(label: "Faixa", value: trackNumber, color: .purple)
                }
            }

            Spacer()

            // Confidence badge
            Text(String(format: "%.0f%%", item.parsed.confidence * 100))
                .font(.caption2.monospacedDigit())
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(confidenceColor.opacity(0.15))
                .foregroundStyle(confidenceColor)
                .cornerRadius(4)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(item.isSelected ? Color.blue.opacity(0.04) : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture { item.isSelected.toggle() }
    }

    private var confidenceColor: Color {
        item.parsed.confidence >= 0.8 ? .green : item.parsed.confidence >= 0.6 ? .orange : .red
    }
}

struct TagPreviewChip: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(color.opacity(0.8))
            Text(value)
                .font(.caption.bold())
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(color.opacity(0.1))
        .cornerRadius(5)
    }
}
