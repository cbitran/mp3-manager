import Foundation

struct AICuePoint: Codable {
    var index: Int
    var positionMs: Int
    var label: String
    var color: String
    var isHot: Bool

    enum CodingKeys: String, CodingKey {
        case index, label, color
        case positionMs = "position_ms"
        case isHot      = "is_hot"
    }
}

struct AIBPMResult: Codable {
    var bpm: Double
    var bpmStr: String
    var firstBeatOffsetMs: Double
    var beatCount: Int
    var confidence: Double
    var analyzer: String
    var key: String?
    var cuePoints: [AICuePoint]?
    var tagsWritten: Bool?
    var virtualdJUpdated: Bool?
    var rekordboxUpdated: Bool?
    var rekordboxPath: String?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case bpm, confidence, analyzer, error, key
        case cuePoints          = "cue_points"
        case bpmStr             = "bpm_str"
        case firstBeatOffsetMs  = "first_beat_offset_ms"
        case beatCount          = "beat_count"
        case tagsWritten        = "tags_written"
        case virtualdJUpdated   = "virtualdj_updated"
        case rekordboxUpdated   = "rekordbox_updated"
        case rekordboxPath      = "rekordbox_path"
    }
}

actor AIBPMService {
    static let shared = AIBPMService()

    private let python3 = "/usr/local/bin/python3"

    private func scriptURL() -> String {
        if let url = Bundle.main.url(forResource: "ai_analyze_bpm", withExtension: "py") {
            return url.path
        }
        return "/Volumes/SSD Interno/Projetos ClaudeCode/mp3 Manager/Sources/MP3Manager/Scripts/ai_analyze_bpm.py"
    }

    func analyze(track: Track) async throws -> AIBPMResult {
        let output = try await ProcessRunner.run(python3, arguments: [scriptURL(), track.url.path])
        return try AIBPMService.decode(output)
    }

    // nonisolated para não prender o actor durante o subprocess
    nonisolated func analyzeAndWrite(track: Track) async throws -> AIBPMResult {
        let python = "/usr/local/bin/python3"
        let script = Bundle.main.url(forResource: "ai_analyze_bpm", withExtension: "py")?.path
            ?? "/Volumes/SSD Interno/Projetos ClaudeCode/mp3 Manager/Sources/MP3Manager/Scripts/ai_analyze_bpm.py"
        let output = try await ProcessRunner.run(python, arguments: [script, track.url.path, "--write"])
        return try AIBPMService.decode(output)
    }

    // Executa até 3 análises em paralelo para ~3× mais velocidade
    func batchAnalyzeAndWrite(tracks: [Track], appState: AppState) async {
        let total = tracks.count
        guard total > 0 else { return }
        let concurrency = min(3, total)

        await MainActor.run {
            appState.isBatchBPMRunning  = true
            appState.batchBPMDone       = 0
            appState.batchBPMTotal      = total
            appState.batchBPMProgress   = 0
            appState.batchBPMResults    = []
            appState.batchBPMCurrent    = ""
            appState.batchBPMActiveIds  = []
        }

        var nextIndex = 0

        await withTaskGroup(of: Void.self) { group in
            // Semeia as primeiras N tarefas concorrentes
            while nextIndex < concurrency {
                let track = tracks[nextIndex]; nextIndex += 1
                group.addTask { await self.processOne(track, total: total, appState: appState) }
            }
            // Reabastece conforme cada tarefa termina
            for await _ in group {
                guard !Task.isCancelled, nextIndex < total else { continue }
                let track = tracks[nextIndex]; nextIndex += 1
                group.addTask { await self.processOne(track, total: total, appState: appState) }
            }
        }

        await MainActor.run {
            appState.isBatchBPMRunning        = false
            appState.batchBPMCurrent          = ""
            appState.batchBPMCurrentId        = nil
            appState.batchBPMActiveIds        = []
            appState.batchBPMTask             = nil
            if !appState.batchBPMResults.isEmpty {
                appState.isShowingBatchBPMResults = true
            }
        }
    }

    // Roda fora do actor para não bloquear outras análises paralelas
    private nonisolated func processOne(_ track: Track, total: Int, appState: AppState) async {
        await MainActor.run {
            appState.batchBPMActiveIds.insert(track.id)
            appState.batchBPMCurrent = track.filename
        }
        do {
            let result = try await analyzeAndWrite(track: track)
            var updated = track
            updated.bpm = result.bpmStr
            if let k = result.key, !k.isEmpty { updated.key = k }
            if let cues = result.cuePoints, !cues.isEmpty {
                updated.djData = applyAICues(cues, to: updated.djData, bpm: result.bpmStr, key: result.key ?? "")
            }
            ValidationService.revalidate(&updated)
            await MainActor.run {
                appState.updateTrack(updated)
                appState.batchBPMResults.append(BatchBPMEntry(filename: track.filename, bpm: result.bpmStr))
                appState.batchBPMActiveIds.remove(track.id)
                appState.batchBPMDone += 1
                appState.batchBPMProgress = Double(appState.batchBPMDone) / Double(total)
            }
        } catch {
            await MainActor.run {
                appState.batchBPMResults.append(BatchBPMEntry(filename: track.filename, error: error.localizedDescription))
                appState.batchBPMActiveIds.remove(track.id)
                appState.batchBPMDone += 1
                appState.batchBPMProgress = Double(appState.batchBPMDone) / Double(total)
            }
        }
    }

    nonisolated func applyAICues(_ cues: [AICuePoint], to existing: DJData?, bpm: String, key: String) -> DJData {
        var djData = existing ?? DJData(source: .serato, bpm: bpm, key: key,
                                        rating: 0, color: "", playCount: 0,
                                        cues: [], loops: [], hasBeatGrid: true, hasOverview: false)
        djData.bpm = bpm
        if !key.isEmpty { djData.key = key }
        djData.cues = cues.map { c in
            CuePoint(index: c.index, positionMs: c.positionMs,
                     name: c.label, color: c.color, isHot: c.isHot)
        }
        return djData
    }

    private static func decode(_ raw: String) throws -> AIBPMResult {
        guard let data = raw.data(using: .utf8) else {
            throw NSError(domain: "AIBPMService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Empty output"])
        }
        let result = try JSONDecoder().decode(AIBPMResult.self, from: data)
        if let err = result.error {
            throw NSError(domain: "AIBPMService", code: 2, userInfo: [NSLocalizedDescriptionKey: err])
        }
        return result
    }
}
