import Foundation

// MARK: - Models

enum PipelineStep: String {
    case filename    = "Nome do arquivo"
    case musicBrainz = "MusicBrainz"
    case acoustID    = "AcoustID"
    case spotify     = "Spotify"
    case lastFM      = "Last.fm"
    case notFound    = "Não encontrado"
}

enum PipelineStatus {
    case pending, running, found, lowConfidence, notFound
}

struct PipelineResult: Identifiable {
    var id: UUID { track.id }
    var track: Track
    var status: PipelineStatus = .pending
    var step: PipelineStep = .filename
    var match: MetadataMatch?
    var apply: Bool = true
}

// MARK: - Service

actor MetadataPipelineService {
    static let shared = MetadataPipelineService()

    func run(
        tracks: [Track],
        onUpdate: @escaping @Sendable (PipelineResult) async -> Void
    ) async {
        for track in tracks {
            var result = PipelineResult(track: track, status: .running)
            await onUpdate(result)

            // Etapa 1: nome do arquivo
            if let parsed = FilenameParser.parse(filename: track.filename),
               !parsed.title.isEmpty {
                let match = MetadataMatch(
                    source: .musicBrainz,
                    title: parsed.artist.isEmpty ? track.title : parsed.title,
                    artist: parsed.artist,
                    album: track.album,
                    year: track.year,
                    trackNumber: parsed.trackNumber,
                    genre: track.genre,
                    label: "",
                    country: "",
                    score: Int(parsed.confidence * 100),
                    externalId: ""
                )
                // Se já tinha tags suficientes, não precisamos de etapas online
                if !track.title.isEmpty && !track.artist.isEmpty && !track.genre.isEmpty {
                    result.status = .found
                    result.step = .filename
                    result.match = match
                    await onUpdate(result)
                    continue
                }
            }

            // Etapa 2: MusicBrainz
            if let mbMatch = await tryMusicBrainz(track: track) {
                result.status = mbMatch.score >= 75 ? .found : .lowConfidence
                result.step = .musicBrainz
                result.match = mbMatch
                await onUpdate(result)
                continue
            }

            // Etapa 3: AcoustID (fingerprint de áudio)
            if let acMatch = await tryAcoustID(track: track) {
                result.status = acMatch.score >= 70 ? .found : .lowConfidence
                result.step = .acoustID
                result.match = acMatch
                await onUpdate(result)
                continue
            }

            // Etapa 4: Spotify (álbum, ano, capa, BPM/Tom se disponível)
            if let spMatch = await trySpotify(track: track) {
                result.status = .found
                result.step = .spotify
                result.match = spMatch
                await onUpdate(result)
                continue
            }

            // Etapa 5: Last.fm (gênero via crowdsourcing)
            if let lfMatch = await tryLastFM(track: track) {
                result.status = .found
                result.step = .lastFM
                result.match = lfMatch
                await onUpdate(result)
                continue
            }

            result.status = .notFound
            result.step = .notFound
            await onUpdate(result)
        }
    }

    private func tryMusicBrainz(track: Track) async -> MetadataMatch? {
        guard let result = try? await MusicBrainzService.shared.enrich(track: track),
              result.enriched || result.score >= 60 else { return nil }

        return MetadataMatch(
            source: .musicBrainz,
            title: track.title,
            artist: track.artist,
            album: result.appliedAlbum ?? track.album,
            year: result.appliedYear ?? track.year,
            trackNumber: "",
            genre: result.appliedGenre ?? track.genre,
            label: "",
            country: "",
            score: result.score,
            externalId: ""
        )
    }

    private func tryAcoustID(track: Track) async -> MetadataMatch? {
        guard !APIKeys.acoustID.isEmpty else { return nil }
        return try? await AcoustIDService.shared.identify(track: track)
    }

    private func trySpotify(track: Track) async -> MetadataMatch? {
        guard let info = await SpotifyService.shared.enrich(track) else { return nil }
        // Só considera útil se trouxe álbum, ano ou BPM
        let hasBpm   = info.audioFeatures != nil
        let hasAlbum = !info.album.isEmpty
        let hasYear  = !info.year.isEmpty
        guard hasBpm || hasAlbum || hasYear else { return nil }

        return MetadataMatch(
            source: .spotify,
            title: track.title,
            artist: track.artist,
            album: hasAlbum ? info.album : track.album,
            year: hasYear ? info.year : track.year,
            trackNumber: "",
            genre: track.genre,
            label: "",
            country: "",
            score: 85,
            externalId: "",
            bpm: info.audioFeatures?.bpm ?? "",
            key: info.audioFeatures?.key ?? ""
        )
    }

    private func tryLastFM(track: Track) async -> MetadataMatch? {
        guard LastFMService.shared.isConfigured else { return nil }
        guard let genre = await LastFMService.shared.topGenre(artist: track.artist, title: track.title), !genre.isEmpty else { return nil }
        return MetadataMatch(
            source: .lastFM,
            title: track.title,
            artist: track.artist,
            album: track.album,
            year: track.year,
            trackNumber: "",
            genre: genre,
            label: "",
            country: "",
            score: 80,
            externalId: ""
        )
    }
}
