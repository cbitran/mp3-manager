import Foundation

actor DiscogsService {
    static let shared = DiscogsService()

    private let baseURL   = "https://api.discogs.com"
    private let userAgent = "MP3Manager/1.0 +celio.bitran@gmail.com"

    func search(track: Track) async throws -> MetadataMatch? {
        let token = APIKeys.discogs
        guard !token.isEmpty else { return nil }

        var components = URLComponents(string: "\(baseURL)/database/search")!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "type",  value: "release"),
            URLQueryItem(name: "token", value: token)
        ]
        if !track.artist.isEmpty { items.append(URLQueryItem(name: "artist",         value: track.artist)) }
        if !track.title.isEmpty  { items.append(URLQueryItem(name: "track",          value: track.title)) }
        if !track.album.isEmpty  { items.append(URLQueryItem(name: "release_title",  value: track.album)) }
        components.queryItems = items

        let searchResult = try await fetch(url: components.url!)
        guard let results = searchResult["results"] as? [[String: Any]],
              let first = results.first else {
            return nil
        }

        let releaseId = first["id"] as? Int ?? 0
        guard releaseId > 0 else { return nil }

        var releaseURL = URLComponents(string: "\(baseURL)/releases/\(releaseId)")!
        releaseURL.queryItems = [URLQueryItem(name: "token", value: token)]
        let release = try await fetch(url: releaseURL.url!)

        let title   = release["title"] as? String ?? first["title"] as? String ?? ""
        let year    = String(release["year"] as? Int ?? 0)
        let country = release["country"] as? String ?? ""
        let labels  = release["labels"] as? [[String: Any]] ?? []
        let label   = labels.first?["name"] as? String ?? ""
        let genres  = release["genres"] as? [String] ?? []
        let genre   = genres.first ?? ""

        let artists = release["artists"] as? [[String: Any]] ?? []
        let artist  = artists.first?["name"] as? String ?? track.artist

        let tracklist = release["tracklist"] as? [[String: Any]] ?? []
        var trackNum = ""
        for t in tracklist {
            let tTitle = (t["title"] as? String ?? "").lowercased()
            let pos    = t["position"] as? String ?? ""
            if tTitle.contains(track.title.lowercased().prefix(10)) {
                trackNum = pos
                break
            }
        }

        // Cover art: prefer primary image thumbnail (150px)
        let images = release["images"] as? [[String: Any]] ?? []
        let primaryImage = images.first(where: { ($0["type"] as? String) == "primary" }) ?? images.first
        let coverArtURL = primaryImage?["uri150"] as? String
                       ?? primaryImage?["uri"] as? String
                       ?? (first["cover_image"] as? String)
                       ?? ""

        let score = calculateScore(track: track, title: title, artist: artist, year: year)

        return MetadataMatch(
            source: .discogs,
            title: title.components(separatedBy: " - ").last ?? title,
            artist: artist,
            album: title.components(separatedBy: " - ").first ?? title,
            year: year == "0" ? "" : year,
            trackNumber: trackNum,
            genre: genre,
            label: label,
            country: country,
            score: score,
            externalId: String(releaseId),
            coverArtURL: coverArtURL
        )
    }

    private func fetch(url: URL) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 12

        let (data, response) = try await URLSession.shared.data(for: request)

        if let http = response as? HTTPURLResponse, http.statusCode == 429 {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            return try await fetch(url: url)
        }

        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func calculateScore(track: Track, title: String, artist: String, year: String) -> Int {
        var score = 60
        let norm = { (s: String) in s.lowercased().folding(options: .diacriticInsensitive, locale: .current) }

        if norm(artist).contains(norm(track.artist)) || norm(track.artist).contains(norm(artist)) { score += 20 }
        if !track.year.isEmpty && year.hasPrefix(track.year.prefix(4)) { score += 10 }
        if norm(title).contains(norm(String(track.title.prefix(8))))    { score += 10 }

        return min(score, 98)
    }
}
