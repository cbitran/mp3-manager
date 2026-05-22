import Foundation

actor AcoustIDService {
    static let shared = AcoustIDService()

    private let fpcalc    = "/opt/homebrew/bin/fpcalc"
    private let apiURL    = "https://api.acoustid.org/v2/lookup"
    private let userAgent = "MP3Manager/1.0 (celio.bitran@gmail.com)"

    func identify(track: Track) async throws -> MetadataMatch? {
        let clientKey = APIKeys.acoustID
        guard !clientKey.isEmpty else { return nil }

        let fpJSON = try await ProcessRunner.run(fpcalc, arguments: ["-json", track.url.path])
        guard let fpData = fpJSON.data(using: .utf8),
              let fp = try? JSONSerialization.jsonObject(with: fpData) as? [String: Any],
              let fingerprint = fp["fingerprint"] as? String,
              let duration = fp["duration"] as? Double else {
            return nil
        }

        var components = URLComponents(string: apiURL)!
        components.queryItems = [
            URLQueryItem(name: "client",      value: clientKey),
            URLQueryItem(name: "fingerprint", value: fingerprint),
            URLQueryItem(name: "duration",    value: String(Int(duration))),
            URLQueryItem(name: "meta",        value: "recordings releases tracks")
        ]

        var request = URLRequest(url: components.url!)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15

        let (data, _) = try await URLSession.shared.data(for: request)

        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["status"] as? String == "ok",
              let results = root["results"] as? [[String: Any]],
              let first = results.first else {
            return nil
        }

        let score = Int(((first["score"] as? Double ?? 0) * 100).rounded())
        guard let recordings = first["recordings"] as? [[String: Any]],
              let rec = recordings.first else {
            return nil
        }

        let title = rec["title"] as? String ?? ""
        let artistCredit = (rec["artists"] as? [[String: Any]])?.first
        let artist = artistCredit?["name"] as? String ?? ""

        let releaseGroups = rec["releasegroups"] as? [[String: Any]] ?? []
        let rg = releaseGroups.first
        let album = rg?["title"] as? String ?? ""

        let releases = rg?["releases"] as? [[String: Any]] ?? []
        let year = String((releases.first?["date"] as? String ?? "").prefix(4))

        return MetadataMatch(
            source: .acoustID,
            title: title,
            artist: artist,
            album: album,
            year: year,
            trackNumber: "",
            genre: "",
            label: "",
            country: "",
            score: score,
            externalId: first["id"] as? String ?? ""
        )
    }
}
