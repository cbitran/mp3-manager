import Foundation

actor DJService {
    static let shared = DJService()

    private let python3 = "/usr/local/bin/python3"

    private func scriptURL(_ name: String) -> String {
        if let url = Bundle.main.url(forResource: name, withExtension: "py", subdirectory: "Scripts") {
            return url.path
        }
        // Fallback para desenvolvimento
        return "/Volumes/SSD Interno/Projetos ClaudeCode/mp3 Manager/Sources/MP3Manager/Scripts/\(name).py"
    }

    // MARK: - Leitura

    func readSerato(track: Track) async throws -> DJData? {
        let script = scriptURL("dj_read_serato")
        let output = try await ProcessRunner.run(python3, arguments: [script, track.url.path])
        return parseResult(output, expectedSource: .serato)
    }

    func readRekordbox(track: Track) async throws -> DJData? {
        let script = scriptURL("dj_read_rekordbox")
        let output = try await ProcessRunner.run(python3, arguments: [script, track.url.path])
        return parseResult(output, expectedSource: .rekordbox)
    }

    func readBestAvailable(track: Track) async -> DJData? {
        async let serato    = try? readSerato(track: track)
        async let rekordbox = try? readRekordbox(track: track)

        let s = await serato
        let r = await rekordbox

        // Preferir o que tem mais dados
        if let rb = r, rb.cues.count >= (s?.cues.count ?? 0) { return rb }
        return s
    }

    // MARK: - Escrita

    func writeDJTags(to track: Track, djData: DJData) async throws -> [String] {
        let script = scriptURL("dj_write_universal")
        let payload = buildPayload(djData)

        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload),
              let jsonStr  = String(data: jsonData, encoding: .utf8) else {
            throw NSError(domain: "DJService", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Falha ao serializar dados DJ"])
        }

        let output = try await ProcessRunner.run(python3, arguments: [script, track.url.path, jsonStr])

        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let changed = json["changed"] as? [String] else {
            if output.contains("\"ok\": true") || output.contains("\"ok\":true") {
                return []
            }
            throw NSError(domain: "DJService", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Script retornou: \(output)"])
        }
        return changed
    }

    // MARK: - Helpers

    private func parseResult(_ json: String, expectedSource: DJSource) -> DJData? {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        guard root["found"] as? Bool == true else { return nil }

        let cuesRaw  = root["cues"]  as? [[String: Any]] ?? []
        let loopsRaw = root["loops"] as? [[String: Any]] ?? []

        let cues: [CuePoint] = cuesRaw.enumerated().compactMap { (i, c) in
            guard let pos = c["position_ms"] as? Int else { return nil }
            return CuePoint(
                index:      c["index"] as? Int ?? i,
                positionMs: pos,
                name:       c["name"]  as? String ?? "",
                color:      c["color"] as? String ?? "#CC0000",
                isHot:      c["is_hot"] as? Bool ?? false
            )
        }

        let loops: [CueLoop] = loopsRaw.enumerated().compactMap { (i, l) in
            guard let inMs = l["in_ms"] as? Int, let outMs = l["out_ms"] as? Int else { return nil }
            return CueLoop(
                index: l["index"] as? Int ?? i,
                inMs:  inMs,
                outMs: outMs,
                name:  l["name"] as? String ?? ""
            )
        }

        let sourceStr = root["source"] as? String ?? ""
        let source: DJSource = sourceStr == "rekordbox" ? .rekordbox : .serato

        return DJData(
            source:      source,
            bpm:         root["bpm"]        as? String ?? "",
            key:         root["key"]        as? String ?? "",
            rating:      root["rating"]     as? Int    ?? 0,
            color:       root["color"]      as? String ?? "",
            playCount:   root["play_count"] as? Int    ?? 0,
            cues:        cues,
            loops:       loops,
            hasBeatGrid: root["has_beatgrid"] as? Bool ?? false,
            hasOverview: root["has_overview"] as? Bool ?? false
        )
    }

    private func buildPayload(_ dj: DJData) -> [String: Any] {
        var payload: [String: Any] = [
            "source": dj.source.rawValue,
            "bpm":    dj.bpm,
            "key":    dj.key,
            "rating": dj.rating,
            "color":  dj.color
        ]

        payload["cues"] = dj.cues.map { c -> [String: Any] in
            ["index": c.index, "position_ms": c.positionMs, "name": c.name, "color": c.color]
        }

        payload["loops"] = dj.loops.map { l -> [String: Any] in
            ["index": l.index, "in_ms": l.inMs, "out_ms": l.outMs, "name": l.name]
        }

        return payload
    }
}
