import Foundation

struct MusicSearchService {

    // MARK: - Public API

    static func search(query: String, in tracks: [Track]) -> (response: String, results: [Track]) {
        let normalized = normalize(query)

        // 1. Faixas sem BPM
        if matchesNoBPM(normalized) {
            let found = tracks.filter { $0.bpm.trimmingCharacters(in: .whitespaces).isEmpty }
            let msg = found.isEmpty
                ? "Nenhuma faixa sem BPM encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") sem BPM detectado:"
            return (msg, found)
        }

        // 2. Faixas com problemas
        if matchesProblems(normalized) {
            let found = tracks.filter { $0.hasProblems }
            let msg = found.isEmpty
                ? "Nenhuma faixa com problemas encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") com problemas:"
            return (msg, found)
        }

        // 3. Sem álbum
        if matchesMissingAlbum(normalized) {
            let found = tracks.filter { $0.album.trimmingCharacters(in: .whitespaces).isEmpty }
            let msg = found.isEmpty
                ? "Nenhuma faixa sem álbum encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") sem álbum:"
            return (msg, found)
        }

        // 4. Sem título
        if matchesMissingTitle(normalized) {
            let found = tracks.filter { $0.title.trimmingCharacters(in: .whitespaces).isEmpty }
            let msg = found.isEmpty
                ? "Nenhuma faixa sem título encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") sem título:"
            return (msg, found)
        }

        // 5. Sem artista
        if matchesMissingArtist(normalized) {
            let found = tracks.filter { $0.artist.trimmingCharacters(in: .whitespaces).isEmpty }
            let msg = found.isEmpty
                ? "Nenhuma faixa sem artista encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") sem artista:"
            return (msg, found)
        }

        // 6. Busca por ano
        if let year = extractYear(normalized) {
            let found = tracks.filter { $0.year.hasPrefix(year) }
            let msg = found.isEmpty
                ? "Nenhuma faixa do ano \(year) encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") do ano \(year):"
            return (msg, found)
        }

        // 7. Busca por pasta/folder
        if let folderTerm = extractFolderTerm(normalized) {
            let found = tracks.filter { normalize($0.url.path).contains(folderTerm) }
            let msg = found.isEmpty
                ? "Nenhuma faixa na pasta '\(folderTerm)' encontrada."
                : "\(found.count) faixa\(found.count == 1 ? "" : "s") na pasta '\(folderTerm)':"
            return (msg, found)
        }

        // 8. Busca geral por tokens (título, artista, álbum, filename, gênero)
        return generalSearch(query: query, normalized: normalized, tracks: tracks)
    }

    // MARK: - Intent detectors

    private static func matchesNoBPM(_ s: String) -> Bool {
        let patterns = ["sem bpm", "without bpm", "faixas sem bpm", "tracks sem bpm",
                        "no bpm", "sem bpm detectado", "bpm vazio", "bpm ausente"]
        return patterns.contains(where: { s.contains($0) })
    }

    private static func matchesProblems(_ s: String) -> Bool {
        let patterns = ["com problemas", "with problems", "problemas", "faixas com problemas",
                        "tracks com problemas", "tem problema", "problematicas"]
        return patterns.contains(where: { s.contains($0) })
    }

    private static func matchesMissingAlbum(_ s: String) -> Bool {
        let patterns = ["sem album", "sem álbum", "without album", "no album",
                        "album vazio", "album ausente", "missing album"]
        return patterns.contains(where: { s.contains($0) })
    }

    private static func matchesMissingTitle(_ s: String) -> Bool {
        let patterns = ["sem titulo", "sem título", "without title", "no title",
                        "titulo vazio", "título vazio", "missing title"]
        return patterns.contains(where: { s.contains($0) })
    }

    private static func matchesMissingArtist(_ s: String) -> Bool {
        let patterns = ["sem artista", "without artist", "no artist",
                        "artista vazio", "artista ausente", "missing artist"]
        return patterns.contains(where: { s.contains($0) })
    }

    private static func extractYear(_ s: String) -> String? {
        // Match "ano 2003", "year 2003", "de 2003", or just "2003" standalone
        let patterns = [
            "(?:ano|year|de)\\s+(\\d{4})",
            "^(\\d{4})$"
        ]
        for pattern in patterns {
            if let match = try? NSRegularExpression(pattern: pattern).firstMatch(
                in: s, range: NSRange(s.startIndex..., in: s)) {
                if let range = Range(match.range(at: 1), in: s) {
                    return String(s[range])
                }
            }
        }
        return nil
    }

    private static func extractFolderTerm(_ s: String) -> String? {
        let patterns = [
            "(?:pasta|folder|diretorio|diretório|directory)\\s+(.+)",
            "(?:na pasta|in folder|in directory)\\s+(.+)"
        ]
        for pattern in patterns {
            if let match = try? NSRegularExpression(pattern: pattern).firstMatch(
                in: s, range: NSRange(s.startIndex..., in: s)) {
                if let range = Range(match.range(at: 1), in: s) {
                    return String(s[range]).trimmingCharacters(in: .whitespaces)
                }
            }
        }
        return nil
    }

    // MARK: - General search (scoring)

    private static func generalSearch(query: String, normalized: String, tracks: [Track]) -> (String, [Track]) {
        let tokens = tokenize(normalized)
        guard !tokens.isEmpty else {
            return ("Por favor, digite algo para buscar.", [])
        }

        // Score each track
        var scored: [(track: Track, score: Int)] = []

        for track in tracks {
            let score = scoreTrack(track, tokens: tokens)
            if score > 0 {
                scored.append((track, score))
            }
        }

        scored.sort { $0.score > $1.score }
        let found = scored.map { $0.track }

        let displayQuery = query.trimmingCharacters(in: .whitespaces)
        if found.isEmpty {
            return ("Sem resultados para '\(displayQuery)'. Tente outros termos.", [])
        }

        let noun = found.count == 1 ? "faixa" : "faixas"
        return ("Encontrei \(found.count) \(noun) com '\(displayQuery)':", found)
    }

    private static func scoreTrack(_ track: Track, tokens: [String]) -> Int {
        var score = 0

        let fields: [(String, Int)] = [
            (normalize(track.title),    4),
            (normalize(track.artist),   3),
            (normalize(track.album),    2),
            (normalize(track.genre),    2),
            (normalize(track.filename), 1),
            (normalize(track.url.path), 1)
        ]

        for token in tokens {
            for (field, weight) in fields {
                if field.contains(token) {
                    score += weight
                }
            }
        }

        return score
    }

    // MARK: - Helpers

    private static func normalize(_ s: String) -> String {
        s.lowercased()
         .folding(options: .diacriticInsensitive, locale: .current)
    }

    private static func tokenize(_ s: String) -> [String] {
        // Split on whitespace and punctuation, filter short tokens
        let separators = CharacterSet.whitespaces.union(.punctuationCharacters)
        return s.components(separatedBy: separators)
                .filter { $0.count >= 2 }
    }
}
