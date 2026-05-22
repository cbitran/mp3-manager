import SwiftUI

struct DJSourceOption: Identifiable, Equatable {
    var id: String
    var name: String
    var icon: String
    var color: Color
    var isAvailable: Bool
    var isComingSoon: Bool = false
    var isSelected: Bool = false
}

struct DJValidationSheet: View {
    let trackCount: Int
    let folderName: String
    var onConfirm: ([String]) -> Void
    var onSkip: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var sources: [DJSourceOption] = [
        DJSourceOption(id: "serato",    name: "Serato DJ",    icon: "waveform",             color: .teal,   isAvailable: true,  isSelected: true),
        DJSourceOption(id: "rekordbox", name: "Rekordbox",    icon: "record.circle",        color: .red,    isAvailable: true,  isSelected: true),
        DJSourceOption(id: "virtualdj", name: "Virtual DJ",   icon: "headphones",           color: .blue,   isAvailable: false, isComingSoon: true),
        DJSourceOption(id: "algorithm", name: "Algorithm",    icon: "waveform.badge.plus",  color: .purple, isAvailable: false, isComingSoon: true),
    ]

    private var selectedIds: [String] { sources.filter { $0.isSelected && $0.isAvailable }.map { $0.id } }
    private var hasSelection: Bool { !selectedIds.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    sourcesList
                    whatWillBeImported
                }
                .padding(20)
            }
            Divider()
            footer
        }
        .frame(width: 440)
        .fixedSize(horizontal: true, vertical: false)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: "music.note.list")
                    .font(.title3)
                    .foregroundStyle(Color.blue)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Validar com softwares DJ?")
                    .font(.title3.bold())
                Text("\(trackCount) música\(trackCount == 1 ? "" : "s") encontrada\(trackCount == 1 ? "" : "s") em \u{201C}\(folderName)\u{201D}")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
    }

    // MARK: - Sources list

    private var sourcesList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quais fontes usar como referência?")
                .font(.callout.bold())

            VStack(spacing: 6) {
                ForEach($sources) { $source in
                    SourceOptionRow(source: $source)
                }
            }
        }
    }

    // MARK: - What will be imported

    private var whatWillBeImported: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("O que será importado")
                .font(.callout.bold())

            FlowLayout(spacing: 6) {
                ForEach(["BPM", "Tom", "Cue Points", "Loops", "Rating", "Cor da faixa", "Beat Grid"], id: \.self) { tag in
                    Text(tag)
                        .font(.caption)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(6)
                }
            }

            Text("Os dados ficam gravados nas tags ID3 do próprio arquivo MP3 — sem depender de nenhum software externo.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Button("Pular por agora") {
                onSkip()
                dismiss()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)

            Spacer()

            Button("Validar depois") {
                onSkip()
                dismiss()
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.escape)

            Button {
                onConfirm(selectedIds)
                dismiss()
            } label: {
                Label("Validar \(trackCount) música\(trackCount == 1 ? "" : "s")", systemImage: "arrow.right.circle.fill")
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return)
            .disabled(!hasSelection)
        }
        .padding(20)
    }
}

// MARK: - SourceToggleRow

struct SourceOptionRow: View {
    @Binding var source: DJSourceOption

    var body: some View {
        HStack(spacing: 12) {
            if source.isAvailable {
                Toggle("", isOn: $source.isSelected)
                    .toggleStyle(.checkbox)
                    .labelsHidden()
            } else {
                Toggle("", isOn: .constant(false))
                    .toggleStyle(.checkbox)
                    .labelsHidden()
                    .disabled(true)
            }

            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(source.color.opacity(source.isAvailable ? 0.15 : 0.06))
                    .frame(width: 34, height: 34)
                Image(systemName: source.icon)
                    .font(.callout)
                    .foregroundStyle(source.isAvailable ? source.color : .secondary)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(source.name)
                    .font(.callout)
                    .foregroundStyle(source.isAvailable ? .primary : .secondary)
                if source.isComingSoon {
                    Text("Em breve")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Disponível")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
            }

            Spacer()

            if source.isAvailable && source.isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(source.color)
                    .font(.callout)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(
            source.isSelected && source.isAvailable
                ? source.color.opacity(0.06)
                : Color.secondary.opacity(0.04)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(source.isSelected && source.isAvailable ? source.color.opacity(0.3) : Color.clear, lineWidth: 1)
        )
        .cornerRadius(10)
        .contentShape(Rectangle())
        .onTapGesture {
            if source.isAvailable { source.isSelected.toggle() }
        }
    }
}

// MARK: - FlowLayout (para os chips)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        let height = rows.map { $0.map { $0.size.height }.max() ?? 0 }.reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            let rowHeight = row.map { $0.size.height }.max() ?? 0
            for item in row {
                item.view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += rowHeight + spacing
        }
    }

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [[(view: LayoutSubview, size: CGSize)]] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[(view: LayoutSubview, size: CGSize)]] = [[]]
        var rowWidth: CGFloat = 0

        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth && !rows.last!.isEmpty {
                rows.append([])
                rowWidth = 0
            }
            rows[rows.count - 1].append((view, size))
            rowWidth += size.width + spacing
        }
        return rows
    }
}
