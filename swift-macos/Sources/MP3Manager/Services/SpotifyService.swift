import Foundation

struct SpotifyAudioFeatures {
    let bpm: String
    let key: String        // Notação padrão (ex: "C", "Cm", "F#", "Bbm")
    let camelotKey: String // Notação Camelot (ex: "8B", "5A") — para referência
    let energy: Double
    let danceability: Double
    let valence: Double
}

struct SpotifyTrackInfo {
    var album: String = ""
    var year: String = ""
    var coverURL: URL? = nil
    var audioFeatures: SpotifyAudioFeatures? = nil // nil se endpoint deprecado
}

enum SpotifyError: Error {
    case notFound
    case audioFeaturesDeprecated  // 403 — endpoint removido para apps novos
    case httpError(Int)
    case decodingError
}

final class SpotifyService {
    static let shared = SpotifyService()
    private init() {}

    private let clientId     = "b1c574848d0b491eb75f94f515e9c7de"
    private let clientSecret = "e5593f4ca9644a4c8ea03ec0b3178913"
    private var accessToken: String?
    private var tokenExpiry: Date = .distantPast
    private let session = URLSession.shared

    // MARK: - Public

    /// Enriquece uma faixa com dados do Spotify.
    /// Sempre tenta buscar álbum/ano/capa. BPM/Tom apenas se audio-features disponível.
    func enrich(_ track: Track) async -> SpotifyTrackInfo? {
        guard !track.title.isEmpty else { return nil }
        do {
            let token = try await getToken()
            guard let (id, info) = try await searchTrack(title: track.title, artist: track.artist, token: token) else { return nil }

            var result = info

            // Tenta audio-features (pode falhar com 403 em apps criados após Nov 2024)
            if let features = try? await getAudioFeatures(id: id, token: token) {
                result.audioFeatures = features
            }

            return result
        } catch { return nil }
    }

    func batchEnrich(tracks: [Track], appState: AppState) async {
        await MainActor.run {
            appState.isSpotifyEnriching   = true
            appState.spotifyEnrichDone    = 0
            appState.spotifyEnrichTotal   = tracks.count
            appState.spotifyEnrichCurrent = ""
        }

        var enrichedCount = 0

        for track in tracks {
            if Task.isCancelled { break }
            await MainActor.run { appState.spotifyEnrichCurrent = track.url.path }

            if let info = await enrich(track) {
                var updated = track
                // BPM e Tom — só se audio-features disponível
                if let f = info.audioFeatures {
                    updated.bpm = f.bpm
                    updated.key = f.key
                }
                // Álbum e ano — sempre aplica se vieram vazios
                if updated.album.isEmpty && !info.album.isEmpty { updated.album = info.album }
                if updated.year.isEmpty  && !info.year.isEmpty  { updated.year  = info.year }

                ValidationService.revalidate(&updated)
                let toWrite = updated
                await MainActor.run { appState.updateTrack(toWrite) }
                try? await TagWriter.shared.writeTags(to: toWrite)
                enrichedCount += 1
            }

            await MainActor.run { appState.spotifyEnrichDone += 1 }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }

        let n = enrichedCount
        await MainActor.run {
            appState.isSpotifyEnriching = false
            appState.spotifyEnrichTask  = nil
            if n == 0 {
                appState.statusMessage = "Spotify: nenhuma faixa encontrada (verifique título/artista)"
            } else {
                appState.statusMessage = "✓ Spotify: \(n) faixa\(n == 1 ? "" : "s") atualizada\(n == 1 ? "" : "s")"
            }
        }
    }

    // MARK: - Auth

    private func getToken() async throws -> String {
        if let t = accessToken, Date() < tokenExpiry { return t }

        var req = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        req.httpMethod = "POST"
        let creds = Data("\(clientId):\(clientSecret)".utf8).base64EncodedString()
        req.setValue("Basic \(creds)", forHTTPHeaderField: "Authorization")
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("grant_type=client_credentials".utf8)

        let (data, _) = try await session.data(for: req)
        let json = try JSONDecoder().decode(TokenResponse.self, from: data)
        accessToken = json.access_token
        tokenExpiry = Date().addingTimeInterval(Double(json.expires_in) - 60)
        return json.access_token
    }

    // MARK: - Search + Track info

    /// Busca a faixa e retorna (spotifyId, TrackInfo com álbum/ano/capa)
    private func searchTrack(title: String, artist: String, token: String) async throws -> (String, SpotifyTrackInfo)? {
        let cleanTitle = title.replacingOccurrences(of: #"\.(mp3|flac|wav|aiff?)$"#, with: "", options: .regularExpression)
        let q = artist.isEmpty ? cleanTitle : "\(cleanTitle) artist:\(artist)"

        var comps = URLComponents(string: "https://api.spotify.com/v1/search")!
        comps.queryItems = [
            .init(name: "q",     value: q),
            .init(name: "type",  value: "track"),
            .init(name: "limit", value: "1"),
        ]
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, http.statusCode != 200 { return nil }

        let json = try JSONDecoder().decode(SearchResponse.self, from: data)
        guard let item = json.tracks.items.first else { return nil }

        var info = SpotifyTrackInfo()
        info.album = item.album.name
        // release_date pode ser "2001", "2001-05", "2001-05-21"
        info.year  = String(item.album.release_date.prefix(4))
        if let imgUrl = item.album.images.first?.url {
            info.coverURL = URL(string: imgUrl)
        }

        return (item.id, info)
    }

    // MARK: - Audio Features (pode retornar 403 em apps novos)

    private func getAudioFeatures(id: String, token: String) async throws -> SpotifyAudioFeatures? {
        var req = URLRequest(url: URL(string: "https://api.spotify.com/v1/audio-features/\(id)")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 403 { throw SpotifyError.audioFeaturesDeprecated }
            if http.statusCode != 200 { throw SpotifyError.httpError(http.statusCode) }
        }

        let f = try JSONDecoder().decode(AudioFeatures.self, from: data)
        guard f.key >= 0 else { return nil }
        return SpotifyAudioFeatures(
            bpm:          String(Int(f.tempo.rounded())),
            key:          standardKey(key: f.key, mode: f.mode),
            camelotKey:   camelotKey(key: f.key, mode: f.mode),
            energy:       f.energy,
            danceability: f.danceability,
            valence:      f.valence
        )
    }

    // MARK: - Key notation

    private func standardKey(key: Int, mode: Int) -> String {
        let notes = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
        guard key < 12 else { return "" }
        return mode == 1 ? notes[key] : "\(notes[key])m"
    }

    private func camelotKey(key: Int, mode: Int) -> String {
        let major = ["8B","3B","10B","5B","12B","7B","2B","9B","4B","11B","6B","1B"]
        let minor = ["5A","12A","7A","2A","9A","4A","11A","6A","1A","8A","3A","10A"]
        guard key < 12 else { return "" }
        return mode == 1 ? major[key] : minor[key]
    }

    // MARK: - Decodable models

    private struct TokenResponse: Decodable {
        let access_token: String
        let expires_in: Int
    }

    private struct SearchResponse: Decodable {
        struct Tracks: Decodable {
            struct Item: Decodable {
                let id: String
                let album: Album
            }
            struct Album: Decodable {
                let name: String
                let release_date: String
                let images: [SpotifyImage]
            }
            struct SpotifyImage: Decodable {
                let url: String
            }
            let items: [Item]
        }
        let tracks: Tracks
    }

    private struct AudioFeatures: Decodable {
        let tempo: Double
        let key: Int
        let mode: Int
        let energy: Double
        let danceability: Double
        let valence: Double
    }
}
