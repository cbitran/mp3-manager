import Foundation

enum FolderOrganizer {

    enum GroupBy: String, CaseIterable, Identifiable {
        case flat      = "Pasta única (sem subpastas)"
        case genre     = "Por Gênero"
        case artist    = "Por Artista"
        case decade    = "Por Décadas"
        case bpmRange  = "Por Faixa de BPM"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .flat:     return "folder"
            case .genre:    return "music.note.list"
            case .artist:   return "person.fill"
            case .decade:   return "calendar"
            case .bpmRange: return "waveform"
            }
        }
    }

    struct Summary {
        var copied: Int = 0
        var moved: Int = 0
        var skipped: Int = 0
        var errors: Int = 0
        var foldersCreated: [String] = []
    }

    static func preview(tracks: [Track], groupBy: GroupBy) -> [(folder: String, count: Int)] {
        var map: [String: Int] = [:]
        for track in tracks {
            let folder = subfolderName(for: track, groupBy: groupBy)
            let key = folder.isEmpty ? "(raiz)" : folder
            map[key, default: 0] += 1
        }
        return map.map { (folder: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
    }

    static func organize(
        tracks: [Track],
        to destination: URL,
        groupBy: GroupBy,
        copy: Bool,
        progress: @escaping (Int) -> Void
    ) async throws -> (summary: Summary, movedURLs: [Track.ID: URL]) {
        var summary = Summary()
        var movedURLs: [Track.ID: URL] = [:]
        let fm = FileManager.default

        for (i, track) in tracks.enumerated() {
            let subfolder = subfolderName(for: track, groupBy: groupBy)
            let targetDir = subfolder.isEmpty
                ? destination
                : destination.appendingPathComponent(subfolder)

            do {
                try fm.createDirectory(at: targetDir, withIntermediateDirectories: true)

                if !subfolder.isEmpty && !summary.foldersCreated.contains(subfolder) {
                    summary.foldersCreated.append(subfolder)
                }

                var targetURL = targetDir.appendingPathComponent(track.url.lastPathComponent)

                // Resolve name collision
                if fm.fileExists(atPath: targetURL.path) {
                    let stem = targetURL.deletingPathExtension().lastPathComponent
                    let ext  = targetURL.pathExtension
                    var n = 2
                    repeat {
                        targetURL = targetDir.appendingPathComponent("\(stem) (\(n)).\(ext)")
                        n += 1
                    } while fm.fileExists(atPath: targetURL.path)
                }

                if copy {
                    try fm.copyItem(at: track.url, to: targetURL)
                    summary.copied += 1
                } else {
                    try fm.moveItem(at: track.url, to: targetURL)
                    movedURLs[track.id] = targetURL
                    summary.moved += 1
                }
            } catch {
                summary.errors += 1
            }

            progress(i + 1)
        }

        return (summary, movedURLs)
    }

    // MARK: - Subfolder name

    private static func subfolderName(for track: Track, groupBy: GroupBy) -> String {
        switch groupBy {
        case .flat:
            return ""

        case .genre:
            let g = track.genre.trimmingCharacters(in: .whitespaces)
            return sanitize(g.isEmpty ? "Sem Gênero" : g)

        case .artist:
            let a = track.artist.trimmingCharacters(in: .whitespaces)
            return sanitize(a.isEmpty ? "Artista Desconhecido" : a)

        case .decade:
            guard let year = Int(track.year.prefix(4)), year > 1000 else { return "Ano Desconhecido" }
            let decade = (year / 10) * 10
            return "Anos \(decade)"

        case .bpmRange:
            guard let bpm = Double(track.bpm), bpm > 0 else { return "BPM Desconhecido" }
            let lo = (Int(bpm) / 10) * 10
            return "\(lo)-\(lo + 9) BPM"
        }
    }

    private static func sanitize(_ name: String) -> String {
        name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespaces)
    }
}
