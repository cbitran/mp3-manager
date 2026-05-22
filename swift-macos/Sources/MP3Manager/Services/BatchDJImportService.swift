import Foundation

actor BatchDJImportService {
    static let shared = BatchDJImportService()

    func run(tracks: [Track], sources: [String], appState: AppState) async {
        let useSerato    = sources.contains("serato")
        let useRekordbox = sources.contains("rekordbox")

        await MainActor.run {
            appState.isDJImporting      = true
            appState.djImportProgress   = 0
            appState.djImportTotal      = tracks.count
            appState.djImportDone       = 0
            appState.djImportCurrent    = ""
            appState.djImportResults    = nil
        }

        var foundSerato    = 0
        var foundRekordbox = 0
        var withCues       = 0
        var withBPM        = 0
        var notFound       = 0

        for (index, track) in tracks.enumerated() {
            await MainActor.run {
                appState.djImportCurrent  = track.title.isEmpty ? track.filename : track.title
                appState.djImportProgress = Double(index) / Double(max(tracks.count, 1))
                appState.djImportDone     = index
            }

            var seratoData:    DJData?
            var rekordboxData: DJData?

            if useSerato {
                seratoData = try? await DJService.shared.readSerato(track: track)
                if seratoData != nil { foundSerato += 1 }
            }

            if useRekordbox {
                rekordboxData = try? await DJService.shared.readRekordbox(track: track)
                if rekordboxData != nil { foundRekordbox += 1 }
            }

            // Escolher melhor fonte: prefere a que tem mais cues
            let best: DJData? = {
                switch (seratoData, rekordboxData) {
                case (let s?, let r?):
                    return r.cues.count >= s.cues.count ? r : s
                case (let s?, nil): return s
                case (nil, let r?): return r
                default: return nil
                }
            }()

            if let dj = best {
                if !dj.cues.isEmpty  { withCues += 1 }
                if !dj.bpm.isEmpty   { withBPM  += 1 }

                var updated = track
                updated.djData = dj
                if updated.bpm.isEmpty && !dj.bpm.isEmpty { updated.bpm = dj.bpm }
                if updated.key.isEmpty && !dj.key.isEmpty { updated.key = dj.key }
                ValidationService.revalidate(&updated)

                await MainActor.run { appState.updateTrack(updated) }
            } else {
                notFound += 1
            }
        }

        let summary = DJImportSummary(
            totalTracks:      tracks.count,
            foundInSerato:    foundSerato,
            foundInRekordbox: foundRekordbox,
            withCuePoints:    withCues,
            withBPM:          withBPM,
            notFound:         notFound
        )

        await MainActor.run {
            appState.isDJImporting       = false
            appState.djImportProgress    = 1.0
            appState.djImportDone        = tracks.count
            appState.djImportResults     = summary
            appState.isShowingDJImportResults = true
            appState.statusMessage       = "\(summary.foundTotal) faixas validadas via DJ • \(withCues) com cue points"
        }
    }
}
