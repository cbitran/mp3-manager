import SwiftUI

struct FolderPreviewSheet: View {
    let preview: FolderScanPreview
    var onConfirm: (Bool) -> Void  // Bool = recursive

    @State private var recursive = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                FolderTree(info: preview.root, level: 0)
                    .padding(16)
            }
            Divider()
            footer
        }
        .frame(minWidth: 480, minHeight: 400)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Prévia do Scan", systemImage: "folder.badge.gearshape")
                .font(.title3.bold())

            HStack(spacing: 20) {
                Label("\(preview.totalFolders) pasta\(preview.totalFolders == 1 ? "" : "s")",
                      systemImage: "folder.fill")
                Label("\(preview.totalFiles) arquivo MP3",
                      systemImage: "music.note")
            }
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(16)
    }

    private var footer: some View {
        HStack {
            Toggle("Incluir subpastas", isOn: $recursive)
                .toggleStyle(.checkbox)

            Spacer()

            Button("Cancelar") { dismiss() }
                .keyboardShortcut(.escape)

            Button("Escanear \(recursive ? "Tudo" : "Pasta Raiz")") {
                onConfirm(recursive)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return)
        }
        .padding(16)
    }
}

struct FolderTree: View {
    let info: FolderScanPreview.FolderInfo
    let level: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if level > 0 {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(width: 1)
                        .frame(height: 16)
                        .padding(.leading, CGFloat(level - 1) * 20 + 8)
                }

                Image(systemName: info.mp3Count > 0 ? "folder.fill" : "folder")
                    .foregroundStyle(info.mp3Count > 0 ? .blue : .secondary)
                    .font(.caption)

                Text(info.name)
                    .font(level == 0 ? .headline : .callout)

                Spacer()

                if info.mp3Count > 0 {
                    Text("\(info.mp3Count) MP3")
                        .font(.caption)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor)
                        .cornerRadius(4)
                }
            }

            ForEach(info.subfolders) { sub in
                FolderTree(info: sub, level: level + 1)
            }
        }
    }
}
