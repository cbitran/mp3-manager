import Foundation
import AppKit

struct iTunesTrackResult {
    let artworkURL: String   // 600×600
    let genre: String
    let year: String         // "2019"
    let album: String
    let trackNumber: String
    let artistName: String
    let trackName: String
}

final class iTunesSearchService {
    static let shared = iTunesSearchService()
    private init() {}

    private let session = URLSession.shared

    // MARK: - Individual search

    func search(track: Track) async -> iTunesTrackResult? {
        let term = track.artist.isEmpty ? track.title : "\(track.artist) \(track.title)"
        var comps = URLComponents(string: "https://itunes.apple.com/search")!
        comps.queryItems = [
            .init(name: "term",    value: term),
            .init(name: "entity",  value: "song"),
            .init(name: "media",   value: "music"),
            .init(name: "limit",   value: "5"),
        ]
        guard let url = comps.url,
              let (data, _) = try? await session.data(from: url),
              let response = try? JSONDecoder().decode(iTunesResponse.self, from: data) else { return nil }

        guard let best = bestMatch(results: response.results, track: track) else { return nil }

        let artwork = best.artworkUrl100
            .replacingOccurrences(of: "100x100bb", with: "600x600bb")
            .replacingOccurrences(of: "/100x100",  with: "/600x600")

        return iTunesTrackResult(
            artworkURL:  artwork,
            genre:       best.primaryGenreName,
            year:        String(best.releaseDate.prefix(4)),
            album:       best.collectionName ?? "",
            trackNumber: best.trackNumber.map(String.init) ?? "",
            artistName:  best.artistName,
            trackName:   best.trackName
        )
    }

    // Download artwork image data
    func downloadArtwork(from urlString: String) async -> (NSImage, Data)? {
        guard let url = URL(string: urlString),
              let (data, _) = try? await session.data(from: url),
              let image = NSImage(data: data) else { return nil }
        return (image, data)
    }

    // MARK: - Batch (fills genre + year + album for tracks missing them)

    func batchEnrich(tracks: [Track], appState: AppState) async {
        let targets = tracks.filter { $0.genre.isEmpty || $0.year.isEmpty }

        await MainActor.run {
            appState.isITunesEnriching   = true
            appState.iTunesEnrichDone    = 0
            appState.iTunesEnrichTotal   = targets.count
            appState.iTunesEnrichCurrent = ""
        }

        for track in targets {
            if Task.isCancelled { break }
            await MainActor.run { appState.iTunesEnrichCurrent = track.url.path }

            if let r = await search(track: track) {
                var updated = track
                if updated.genre.isEmpty && !r.genre.isEmpty { updated.genre = r.genre }
                if updated.year.isEmpty  && !r.year.isEmpty  { updated.year  = r.year  }
                if updated.album.isEmpty && !r.album.isEmpty { updated.album = r.album }

                // Capa via iTunes
                var coverTmpPath = ""
                if let (_, imgData) = await downloadArtwork(from: r.artworkURL) {
                    let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
                        .appendingPathComponent("mp3mgr_it_\(UUID().uuidString).jpg")
                    if (try? imgData.write(to: tmp)) != nil {
                        coverTmpPath = tmp.path
                        updated.coverVersion += 1
                    }
                }

                ValidationService.revalidate(&updated)
                let toWrite = updated
                await MainActor.run { appState.updateTrack(toWrite) }
                try? await TagWriter.shared.writeTags(to: toWrite, coverURL: coverTmpPath)
                if !coverTmpPath.isEmpty { try? FileManager.default.removeItem(atPath: coverTmpPath) }
            }

            await MainActor.run { appState.iTunesEnrichDone += 1 }
            try? await Task.sleep(nanoseconds: 60_000_000) // 60ms — iTunes sem limite oficial, conservador
        }

        await MainActor.run {
            appState.isITunesEnriching = false
            appState.iTunesEnrichTask  = nil
            let n = appState.iTunesEnrichDone
            appState.statusMessage = "✓ iTunes: \(n) faixa\(n == 1 ? "" : "s") enriquecida\(n == 1 ? "" : "s")"
        }
    }

    // MARK: - Best match selection

    private func bestMatch(results: [iTunesTrack], track: Track) -> iTunesTrack? {
        let norm = { (s: String) in s.lowercased().folding(options: .diacriticInsensitive, locale: .current) }
        let tNorm = norm(track.title)
        let aNorm = norm(track.artist)

        if let exact = results.first(where: {
            norm($0.trackName).contains(tNorm) &&
            (aNorm.isEmpty || norm($0.artistName).contains(aNorm))
        }) { return exact }

        return results.first
    }

    // MARK: - Decodable

    private struct iTunesResponse: Decodable {
        let resultCount: Int
        let results: [iTunesTrack]
    }

    private struct iTunesTrack: Decodable {
        let trackName: String
        let artistName: String
        let collectionName: String?
        let artworkUrl100: String
        let primaryGenreName: String
        let releaseDate: String
        let trackNumber: Int?
    }
}
