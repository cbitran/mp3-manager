import Foundation

// MARK: - IgnoreService

enum IgnoreService {
    private static let udKey = "mp3mgr_ignored_v1"

    static func load(for url: URL) -> Set<String> {
        let d = UserDefaults.standard.dictionary(forKey: udKey) as? [String: [String]] ?? [:]
        return Set(d[url.path] ?? [])
    }

    static func ignore(_ key: String, for url: URL) {
        var d = UserDefaults.standard.dictionary(forKey: udKey) as? [String: [String]] ?? [:]
        var s = Set(d[url.path] ?? [])
        s.insert(key)
        d[url.path] = Array(s)
        UserDefaults.standard.set(d, forKey: udKey)
    }

    static func restore(_ key: String, for url: URL) {
        var d = UserDefaults.standard.dictionary(forKey: udKey) as? [String: [String]] ?? [:]
        var s = Set(d[url.path] ?? [])
        s.remove(key)
        if s.isEmpty { d.removeValue(forKey: url.path) } else { d[url.path] = Array(s) }
        UserDefaults.standard.set(d, forKey: udKey)
    }
}

// MARK: - ValidationService

enum ValidationService {
    static func detect(track: Track) -> [TrackProblem] {
        var problems: [TrackProblem] = []

        if track.title.trimmingCharacters(in: .whitespaces).isEmpty {
            problems.append(.missingTitle)
        }
        if track.artist.trimmingCharacters(in: .whitespaces).isEmpty {
            problems.append(.missingArtist)
        }
        if track.album.trimmingCharacters(in: .whitespaces).isEmpty {
            problems.append(.missingAlbum)
        }

        if track.year == "1970" || track.year == "0" {
            problems.append(.wrongYear(track.year))
        }

        if track.comment.lowercased().contains("spotidownloader") {
            problems.append(.spotidownloaderOrigin)
        }

        return problems.filter { !track.ignoredProblems.contains($0.key) }
    }

    static func revalidate(_ track: inout Track) {
        track.problems = detect(track: track)
    }
}
