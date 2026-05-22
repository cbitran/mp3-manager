import Foundation

actor TagWriter {
    static let shared = TagWriter()

    private let python3 = "/usr/local/bin/python3"

    private var scriptPath: String {
        if let url = Bundle.main.url(forResource: "write_tags", withExtension: "py") {
            return url.path
        }
        return "/Volumes/SSD Interno/Projetos ClaudeCode/mp3 Manager/Sources/MP3Manager/Scripts/write_tags.py"
    }

    func writeTags(to track: Track, coverURL: String = "") async throws {
        let tags: [String: String] = [
            "title":  track.title,
            "artist": track.artist,
            "album":  track.album,
            "year":   track.year,
            "track":  track.totalTracks.isEmpty ? track.trackNumber : "\(track.trackNumber)/\(track.totalTracks)",
            "bpm":    track.bpm,
            "key":    track.key,
            "genre":  track.genre,
            "rating": track.rating > 0 ? "\(track.rating)" : "",
        ].filter { !$0.value.isEmpty }

        let jsonData = try JSONSerialization.data(withJSONObject: tags)
        guard let jsonStr = String(data: jsonData, encoding: .utf8) else {
            throw NSError(domain: "TagWriter", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Falha ao serializar JSON"])
        }

        var args = [scriptPath, track.url.path, jsonStr]
        if !coverURL.isEmpty { args.append(coverURL) }
        _ = try await ProcessRunner.run(python3, arguments: args)
    }

    func renameFile(track: Track) async throws -> URL {
        let dir = track.url.deletingLastPathComponent()
        let newURL = dir.appendingPathComponent(track.expectedFilename)

        guard newURL != track.url else { return track.url }

        try FileManager.default.moveItem(at: track.url, to: newURL)
        return newURL
    }
}
