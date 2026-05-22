import Foundation

// API key gratuita em: https://www.last.fm/api/account/create
// Após registro, cole aqui:
private let kLastFMApiKey = ""

final class LastFMService {
    static let shared = LastFMService()
    private init() {}

    var isConfigured: Bool { !kLastFMApiKey.isEmpty }

    private let session = URLSession.shared
    private let baseURL = "https://ws.audioscrobbler.com/2.0/"

    // MARK: - Individual — retorna o melhor tag de gênero

    func topGenre(artist: String, title: String) async -> String? {
        guard isConfigured else { return nil }
        var comps = URLComponents(string: baseURL)!
        comps.queryItems = [
            .init(name: "method",  value: "track.getTopTags"),
            .init(name: "api_key", value: kLastFMApiKey),
            .init(name: "artist",  value: artist),
            .init(name: "track",   value: title),
            .init(name: "format",  value: "json"),
        ]
        guard let url = comps.url,
              let (data, _) = try? await session.data(from: url),
              let json = try? JSONDecoder().decode(TopTagsResponse.self, from: data) else { return nil }

        // Filtra tags genéricas e pega o mais popular
        let blocked: Set<String> = ["seen live", "favourites", "favorite", "love", "loved", "spotify",
                                    "beautiful", "amazing", "awesome", "cool", "great"]
        return json.toptags.tag
            .filter { !blocked.contains($0.name.lowercased()) && $0.count > 0 }
            .first?.name
    }

    // MARK: - Batch (preenche gênero para faixas sem gênero)

    func batchEnrichGenre(tracks: [Track], appState: AppState) async {
        guard isConfigured else {
            await MainActor.run {
                appState.statusMessage = "Last.fm: API key não configurada — acesse last.fm/api"
            }
            return
        }

        let targets = tracks.filter { $0.genre.isEmpty && !$0.artist.isEmpty && !$0.title.isEmpty }

        await MainActor.run {
            appState.isLastFMEnriching   = true
            appState.lastFMEnrichDone    = 0
            appState.lastFMEnrichTotal   = targets.count
            appState.lastFMEnrichCurrent = ""
        }

        for track in targets {
            if Task.isCancelled { break }
            await MainActor.run { appState.lastFMEnrichCurrent = track.url.path }

            if let genre = await topGenre(artist: track.artist, title: track.title) {
                var updated = track
                updated.genre = genre
                ValidationService.revalidate(&updated)
                let toWrite = updated
                await MainActor.run { appState.updateTrack(toWrite) }
                try? await TagWriter.shared.writeTags(to: toWrite)
            }

            await MainActor.run { appState.lastFMEnrichDone += 1 }
            try? await Task.sleep(nanoseconds: 250_000_000) // 4 req/s — dentro do limite Last.fm
        }

        await MainActor.run {
            appState.isLastFMEnriching = false
            appState.lastFMEnrichTask  = nil
            let n = appState.lastFMEnrichDone
            appState.statusMessage = "✓ Last.fm: \(n) faixa\(n == 1 ? "" : "s") com gênero preenchido"
        }
    }

    // MARK: - Decodable

    private struct TopTagsResponse: Decodable {
        struct TopTags: Decodable {
            struct Tag: Decodable {
                let name: String
                let count: Int
            }
            let tag: [Tag]
        }
        let toptags: TopTags
    }
}
