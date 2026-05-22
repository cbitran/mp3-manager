import Foundation

actor MusicBrainzService {
    static let shared = MusicBrainzService()

    private let baseURL  = "https://musicbrainz.org/ws/2"
    private let userAgent = "MP3Manager/1.0 (celio.bitran@gmail.com)"
    private var lastRequestTime: Date = .distantPast

    // MARK: - Existing validate (unchanged)

    func validate(track: Track) async throws -> MusicBrainzResult? {
        guard !track.artist.isEmpty || !track.title.isEmpty else { return nil }

        let artistQ = track.artist.isEmpty ? "" : "artist:\"\(track.artist)\""
        let titleQ  = track.title.isEmpty  ? "" : "recording:\"\(track.title)\""
        let query   = [artistQ, titleQ].filter { !$0.isEmpty }.joined(separator: " AND ")

        guard var components = URLComponents(string: "\(baseURL)/recording/") else { return nil }
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: "5"),
            URLQueryItem(name: "fmt", value: "json")
        ]
        guard let url = components.url else { return nil }

        let data = try await rateLimited(url: url)

        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let recordings = root["recordings"] as? [[String: Any]],
              let first = recordings.first else { return nil }

        let mbTitle  = first["title"] as? String ?? ""
        let score    = Int(first["score"] as? String ?? "0") ?? (first["score"] as? Int ?? 0)
        let artistCredit = (first["artist-credit"] as? [[String: Any]])?.first
        let mbArtist = (artistCredit?["artist"] as? [String: Any])?["name"] as? String ?? ""
        let releases     = first["releases"] as? [[String: Any]] ?? []
        let firstRelease = releases.first
        let mbAlbum  = firstRelease?["title"] as? String ?? ""
        let mbYear   = (firstRelease?["date"] as? String ?? "").prefix(4).description
        let mbId     = first["id"] as? String ?? ""

        return MusicBrainzResult(
            mbTitle: mbTitle, mbArtist: mbArtist, mbAlbum: mbAlbum, mbYear: mbYear,
            score: score, recordingId: mbId,
            titleMatch:  normalize(mbTitle)  == normalize(track.title),
            artistMatch: normalize(mbArtist) == normalize(track.artist),
            albumMatch:  !mbAlbum.isEmpty && normalize(mbAlbum) == normalize(track.album),
            yearMatch:   !mbYear.isEmpty  && mbYear == track.year.prefix(4).description
        )
    }

    // MARK: - Enrich (gênero + campos faltantes)

    func enrich(track: Track) async throws -> MetadataEnrichResult {
        var result = MetadataEnrichResult(trackId: track.id, filename: track.filename, score: 0)

        // Passo 1: busca pelo recording
        let artistQ = "artist:\"\(track.artist)\""
        let titleQ  = "recording:\"\(track.title)\""
        let query   = "\(artistQ) AND \(titleQ)"

        guard var components = URLComponents(string: "\(baseURL)/recording/") else {
            result.skipped = true; return result
        }
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: "3"),
            URLQueryItem(name: "fmt",   value: "json")
        ]
        guard let searchURL = components.url else { result.skipped = true; return result }

        let searchData = try await rateLimited(url: searchURL)
        guard let root = try? JSONSerialization.jsonObject(with: searchData) as? [String: Any],
              let recordings = root["recordings"] as? [[String: Any]],
              let first = recordings.first else {
            result.skipped = true; return result
        }

        let score = Int(first["score"] as? String ?? "0") ?? (first["score"] as? Int ?? 0)
        result.score = score
        guard score >= 70, let mbId = first["id"] as? String else {
            result.skipped = true; return result
        }

        // Preenche ano e álbum já disponíveis no resultado da busca
        let releases     = first["releases"] as? [[String: Any]] ?? []
        let firstRelease = releases.first
        let mbYear  = (firstRelease?["date"] as? String ?? "").prefix(4).description
        let mbAlbum = firstRelease?["title"] as? String ?? ""
        if track.year.isEmpty  && !mbYear.isEmpty  { result.appliedYear  = mbYear  }
        if track.album.isEmpty && !mbAlbum.isEmpty { result.appliedAlbum = mbAlbum }

        // Passo 2: busca tags/gêneros via lookup
        if track.genre.isEmpty {
            if let genreURL = URL(string: "\(baseURL)/recording/\(mbId)?inc=tags+genres&fmt=json") {
                let tagData = try await rateLimited(url: genreURL)
                if let tagRoot = try? JSONSerialization.jsonObject(with: tagData) as? [String: Any] {
                    let genre = bestGenre(from: tagRoot)
                    if let g = genre, !g.isEmpty { result.appliedGenre = g }
                }
            }
        }

        return result
    }

    // MARK: - Batch enrichment

    func batchEnrich(tracks: [Track], appState: AppState) async {
        let targets = tracks.filter {
            !$0.title.isEmpty && !$0.artist.isEmpty &&
            ($0.genre.isEmpty || $0.year.isEmpty || $0.album.isEmpty)
        }
        guard !targets.isEmpty else {
            await MainActor.run { appState.isEnriching = false }
            return
        }

        await MainActor.run {
            appState.isEnriching  = true
            appState.enrichTotal  = targets.count
            appState.enrichDone   = 0
            appState.enrichCurrent = ""
            appState.enrichResults = []
        }

        for (i, track) in targets.enumerated() {
            if Task.isCancelled { break }

            await MainActor.run {
                appState.enrichCurrent   = track.filename
                appState.enrichCurrentId = track.id
                appState.enrichDone      = i
            }

            do {
                let result = try await enrich(track: track)

                if result.enriched && result.score >= 75 {
                    var updated = track
                    if let g = result.appliedGenre { updated.genre = g }
                    if let y = result.appliedYear  { updated.year  = y }
                    if let a = result.appliedAlbum { updated.album = a }
                    ValidationService.revalidate(&updated)
                    await MainActor.run { appState.updateTrack(updated) }
                    try? await TagWriter.shared.writeTags(to: updated)
                }

                await MainActor.run { appState.enrichResults.append(result) }
            } catch {
                // ignora erros individuais e continua
            }
        }

        await MainActor.run {
            appState.isEnriching     = false
            appState.enrichCurrent   = ""
            appState.enrichCurrentId = nil
            appState.enrichTask      = nil
            let p = appState.tracks.filter { $0.hasProblems }.count
            let enriched = appState.enrichResults.filter { $0.enriched }.count
            appState.statusMessage = "\(appState.tracks.count) músicas • \(enriched) enriquecidas"
            if !appState.enrichResults.isEmpty {
                appState.isShowingEnrichResults = true
            }
        }
    }

    // MARK: - Helpers

    private func bestGenre(from root: [String: Any]) -> String? {
        // Prefere genres (curados) sobre tags (crowd-sourced)
        for key in ["genres", "tags"] {
            if let list = root[key] as? [[String: Any]] {
                let sorted = list.compactMap { item -> (String, Int)? in
                    guard let name  = item["name"]  as? String,
                          let count = item["count"] as? Int else { return nil }
                    return (name, count)
                }.sorted { $0.1 > $1.1 }

                if let top = sorted.first {
                    return top.0
                        .split(separator: " ")
                        .map { $0.prefix(1).uppercased() + $0.dropFirst() }
                        .joined(separator: " ")
                }
            }
        }
        return nil
    }

    private func rateLimited(url: URL) async throws -> Data {
        let elapsed = Date().timeIntervalSince(lastRequestTime)
        if elapsed < 1.1 {
            try await Task.sleep(nanoseconds: UInt64((1.1 - elapsed) * 1_000_000_000))
        }
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 12
        let (data, _) = try await URLSession.shared.data(for: request)
        lastRequestTime = Date()
        return data
    }

    private func normalize(_ s: String) -> String {
        s.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
