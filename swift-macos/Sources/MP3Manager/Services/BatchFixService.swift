import Foundation

actor BatchFixService {
    static let shared = BatchFixService()

    func run(tracks: [Track], appState: AppState) async {
        await MainActor.run {
            appState.isBatchRunning = true
            appState.batchProgress  = 0
            appState.batchTotal     = tracks.count
            appState.batchDone      = 0
            appState.batchCurrent   = ""
            appState.batchLog       = []
            appState.reviewQueue    = []
        }

        for (index, track) in tracks.enumerated() {
            await MainActor.run {
                appState.batchProgress = Double(index) / Double(tracks.count)
                appState.batchDone     = index + 1
                appState.batchCurrent  = track.filename
                appState.statusMessage = "Analisando \(track.filename)… (\(index+1)/\(tracks.count))"
            }

            let matches = await fetchAllSources(track: track)

            if matches.isEmpty {
                continue
            }

            let best = matches.max(by: { $0.score < $1.score })!

            if best.isHighConfidence {
                let (updated, log) = applyMatch(best, to: track)
                if !log.changes.isEmpty {
                    do {
                        try await TagWriter.shared.writeTags(to: updated)
                        await MainActor.run {
                            appState.updateTrack(updated)
                            appState.batchLog.append(log)
                        }
                    } catch {
                        await MainActor.run {
                            appState.statusMessage = "Erro ao salvar \(track.filename): \(error.localizedDescription)"
                        }
                    }
                }
            } else {
                let item = ReviewItem(track: track, matches: matches)
                await MainActor.run {
                    appState.reviewQueue.append(item)
                }
            }
        }

        await MainActor.run {
            let autoFixed = appState.batchLog.count
            let queued    = appState.reviewQueue.count
            appState.statusMessage   = "\(autoFixed) corrigidas automaticamente • \(queued) aguardando revisão"
            appState.batchProgress   = 1.0
            appState.batchCurrent    = ""
            appState.batchDone       = 0
            appState.isBatchRunning  = false
            appState.isShowingBatchResults = true
        }
    }

    private func fetchAllSources(track: Track) async -> [MetadataMatch] {
        async let mbMatch     = fetchMB(track: track)
        async let discogsMatch = fetchDiscogs(track: track)
        async let acoustMatch = fetchAcoustID(track: track)

        var results: [MetadataMatch] = []
        if let m = await mbMatch     { results.append(m) }
        if let m = await discogsMatch { results.append(m) }
        if let m = await acoustMatch  { results.append(m) }
        return results
    }

    private func fetchMB(track: Track) async -> MetadataMatch? {
        guard let result = try? await MusicBrainzService.shared.validate(track: track) else { return nil }
        return MetadataMatch(
            source: .musicBrainz,
            title: result.mbTitle,
            artist: result.mbArtist,
            album: result.mbAlbum,
            year: result.mbYear,
            trackNumber: "",
            genre: "",
            label: "",
            country: "",
            score: result.score,
            externalId: result.recordingId
        )
    }

    private func fetchDiscogs(track: Track) async -> MetadataMatch? {
        try? await DiscogsService.shared.search(track: track)
    }

    private func fetchAcoustID(track: Track) async -> MetadataMatch? {
        try? await AcoustIDService.shared.identify(track: track)
    }

    private func applyMatch(_ match: MetadataMatch, to track: Track) -> (Track, BatchLogEntry) {
        var updated = track
        var changes: [(field: String, from: String, to: String)] = []

        func apply(_ field: String, current: inout String, new: String) {
            let newTrimmed = new.trimmingCharacters(in: .whitespaces)
            if !newTrimmed.isEmpty && newTrimmed != current {
                changes.append((field: field, from: current, to: newTrimmed))
                current = newTrimmed
            }
        }

        apply("Título",  current: &updated.title,  new: match.title)
        apply("Artista", current: &updated.artist, new: match.artist)
        apply("Álbum",   current: &updated.album,  new: match.album)
        apply("Ano",     current: &updated.year,   new: match.year)

        if !match.trackNumber.isEmpty {
            apply("Faixa", current: &updated.trackNumber, new: match.trackNumber)
        }
        if !match.genre.isEmpty {
            apply("Gênero", current: &updated.genre, new: match.genre)
        }

        ValidationService.revalidate(&updated)

        let log = BatchLogEntry(filename: track.filename, changes: changes, source: match.source)
        return (updated, log)
    }
}
