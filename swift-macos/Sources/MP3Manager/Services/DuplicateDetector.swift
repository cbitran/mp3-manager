import Foundation
import CryptoKit
import SwiftUI

// MARK: - Models

struct DuplicateGroup: Identifiable {
    var id = UUID()
    var reason: DuplicateReason
    var tracks: [Track]

    var suggestedKeepId: Track.ID? {
        tracks.max { tagScore($0) < tagScore($1) }?.id
    }

    private func tagScore(_ t: Track) -> Int {
        [t.title, t.artist, t.album, t.year, t.genre, t.bpm].filter { !$0.isEmpty }.count
    }
}

enum DuplicateReason {
    case exactFile
    case similarMeta

    var label: String {
        switch self {
        case .exactFile:   return "Arquivo idêntico"
        case .similarMeta: return "Metadados similares"
        }
    }
    var icon: String {
        switch self {
        case .exactFile:   return "doc.on.doc.fill"
        case .similarMeta: return "music.note.list"
        }
    }
    var color: Color {
        switch self {
        case .exactFile:   return .red
        case .similarMeta: return .orange
        }
    }
}

// MARK: - Detector

enum DuplicateDetector {

    static func detect(in tracks: [Track]) async -> [DuplicateGroup] {
        var groups: [DuplicateGroup] = []
        var usedIds = Set<Track.ID>()

        // Camada 1 — fingerprint parcial (tamanho + hash 8KB início + 8KB fim)
        let exactGroups = await groupByFingerprint(tracks)
        for group in exactGroups where group.count > 1 {
            groups.append(DuplicateGroup(reason: .exactFile, tracks: group))
            group.forEach { usedIds.insert($0.id) }
        }

        // Camada 3 — similaridade de tokens (título + artista)
        let remaining = tracks.filter {
            !$0.title.isEmpty && !$0.artist.isEmpty && !usedIds.contains($0.id)
        }
        let metaGroups = groupByMetaSimilarity(remaining)
        for group in metaGroups {
            groups.append(DuplicateGroup(reason: .similarMeta, tracks: group))
        }

        return groups.sorted {
            if $0.reason == .exactFile && $1.reason != .exactFile { return true }
            if $0.reason != .exactFile && $1.reason == .exactFile { return false }
            return $0.tracks.count > $1.tracks.count
        }
    }

    // MARK: Layer 1 — Fingerprint

    private static func groupByFingerprint(_ tracks: [Track]) async -> [[Track]] {
        // Pré-agrupa por tamanho (filtro rápido antes de calcular hash)
        var sizeMap: [Int: [Track]] = [:]
        for t in tracks {
            if let size = try? t.url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0 {
                sizeMap[size, default: []].append(t)
            }
        }

        var results: [[Track]] = []
        for (_, candidates) in sizeMap where candidates.count > 1 {
            var hashMap: [String: [Track]] = [:]
            for t in candidates {
                if let fp = partialHash(t.url) { hashMap[fp, default: []].append(t) }
            }
            for (_, group) in hashMap where group.count > 1 { results.append(group) }
        }
        return results
    }

    private static func partialHash(_ url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        let chunk = 8192
        let first = try? handle.read(upToCount: chunk)
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0 else { return nil }

        if size > chunk * 2 { try? handle.seek(toOffset: UInt64(size - chunk)) }
        let last = try? handle.read(upToCount: chunk)

        var hasher = SHA256()
        if let d = "\(size)".data(using: .utf8) { hasher.update(data: d) }
        if let f = first { hasher.update(data: f) }
        if let l = last  { hasher.update(data: l) }
        return hasher.finalize().prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Layer 3 — Token similarity

    private static func groupByMetaSimilarity(_ tracks: [Track]) -> [[Track]] {
        var used = Set<Track.ID>()
        var groups: [[Track]] = []

        for i in 0..<tracks.count {
            guard !used.contains(tracks[i].id) else { continue }
            var group = [tracks[i]]

            for j in (i+1)..<tracks.count {
                guard !used.contains(tracks[j].id) else { continue }
                if areSimilar(tracks[i], tracks[j]) {
                    group.append(tracks[j])
                    used.insert(tracks[j].id)
                }
            }
            if group.count > 1 {
                used.insert(tracks[i].id)
                groups.append(group)
            }
        }
        return groups
    }

    // Requer que os TÍTULOS também sejam independentemente similares.
    // Evita falsos positivos com mesmo artista + músicas completamente diferentes.
    private static func areSimilar(_ a: Track, _ b: Track) -> Bool {
        let titleA = titleTokens(a)
        let titleB = titleTokens(b)
        guard !titleA.isEmpty && !titleB.isEmpty else { return false }
        guard containment(titleA, titleB) >= 0.6 else { return false }
        return containment(tokens(a), tokens(b)) >= 0.85
    }

    private static func tokens(_ t: Track) -> Set<String> {
        normalize("\(t.artist) \(t.title)")
    }

    private static func titleTokens(_ t: Track) -> Set<String> {
        normalize(t.title)
    }

    private static func normalize(_ s: String) -> Set<String> {
        Set(
            s.lowercased()
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
                .components(separatedBy: .init(charactersIn: " -_.,()[]&+/"))
                .filter { $0.count > 1 }
        )
    }

    // Fração do conjunto menor contida no maior (detecta versões com sufixos extras)
    private static func containment(_ a: Set<String>, _ b: Set<String>) -> Double {
        guard !a.isEmpty && !b.isEmpty else { return 0 }
        let smaller = min(a.count, b.count)
        return Double(a.intersection(b).count) / Double(smaller)
    }
}

// MARK: - AppState helpers

extension Array where Element == DuplicateGroup {
    mutating func resolveGroup(_ groupId: DuplicateGroup.ID) {
        removeAll { $0.id == groupId }
    }
    mutating func resolveTrack(_ trackId: Track.ID, inGroup groupId: DuplicateGroup.ID) {
        guard let idx = firstIndex(where: { $0.id == groupId }) else { return }
        self[idx].tracks.removeAll { $0.id == trackId }
        if self[idx].tracks.count < 2 { remove(at: idx) }
    }
}
