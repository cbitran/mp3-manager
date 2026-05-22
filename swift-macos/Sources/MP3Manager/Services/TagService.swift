import Foundation
import AVFoundation
import AppKit

actor TagService {
    static let shared = TagService()

    private let ffprobe = "/opt/homebrew/bin/ffprobe"

    func buildPreview(for root: URL) async throws -> FolderScanPreview {
        let info = try await buildFolderInfo(root)
        let totalFolders = countFolders(info)
        return FolderScanPreview(root: info, totalFolders: totalFolders, totalFiles: info.totalCount)
    }

    private func buildFolderInfo(_ url: URL) async throws -> FolderScanPreview.FolderInfo {
        let fm = FileManager.default
        let contents = try fm.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        )

        let mp3Count = contents.filter { $0.pathExtension.lowercased() == "mp3" }.count
        var subfolders: [FolderScanPreview.FolderInfo] = []

        for item in contents.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: item.path, isDirectory: &isDir), isDir.boolValue {
                if let sub = try? await buildFolderInfo(item), sub.totalCount > 0 {
                    subfolders.append(sub)
                }
            }
        }

        return FolderScanPreview.FolderInfo(url: url, name: url.lastPathComponent,
                                            mp3Count: mp3Count, subfolders: subfolders)
    }

    private func countFolders(_ info: FolderScanPreview.FolderInfo) -> Int {
        1 + info.subfolders.reduce(0) { $0 + countFolders($1) }
    }

    // Lê até 16 faixas em paralelo; chama onFound à medida que chegam
    func scanFolder(_ folder: URL, recursive: Bool = false,
                    onFound: (@MainActor (Track, Int, Int) -> Void)? = nil) async throws -> [Track] {
        let urls = try collectMP3URLs(in: folder, recursive: recursive)
        let total = urls.count
        guard total > 0 else { return [] }

        let concurrency = min(16, total)
        var results   = Array<Track?>(repeating: nil, count: total)
        var nextIndex = 0
        var done      = 0

        await withTaskGroup(of: (Int, Track?).self) { group in
            // Semeia as primeiras N leituras paralelas
            while nextIndex < concurrency {
                let idx = nextIndex; nextIndex += 1
                let url = urls[idx]
                group.addTask { (idx, try? await self.readTrack(from: url)) }
            }

            // Coleta resultados e reabastece o pool
            for await (idx, track) in group {
                if let t = track {
                    results[idx] = t
                    done += 1
                    let d = done
                    if let cb = onFound {
                        await MainActor.run { cb(t, d, total) }
                    }
                }
                guard nextIndex < total else { continue }
                let i = nextIndex; nextIndex += 1
                let url = urls[i]
                group.addTask { (i, try? await self.readTrack(from: url)) }
            }
        }

        return results.compactMap { $0 }
    }

    // nonisolated: múltiplas chamadas rodam em paralelo sem bloquear o actor
    nonisolated func readTrack(from url: URL) async throws -> Track {
        let ffprobePath = "/opt/homebrew/bin/ffprobe"
        let json = try await ProcessRunner.run(ffprobePath, arguments: [
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            url.path
        ])

        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let format = root["format"] as? [String: Any],
              let rawTags = format["tags"] as? [String: Any] else {
            return Self.makeEmptyTrack(url: url)
        }

        func tag(_ keys: String...) -> String {
            for k in keys {
                if let v = rawTags[k] as? String, !v.isEmpty { return v }
                if let v = rawTags[k.uppercased()] as? String, !v.isEmpty { return v }
                if let v = rawTags[k.lowercased()] as? String, !v.isEmpty { return v }
            }
            return ""
        }

        let trackField = tag("track", "TRCK")
        var trackNum   = ""
        var totalTracks = ""
        if trackField.contains("/") {
            let parts = trackField.split(separator: "/")
            trackNum    = String(parts.first ?? "")
            totalTracks = String(parts.last ?? "")
        } else {
            trackNum = trackField
        }

        let duration = Double(format["duration"] as? String ?? "") ?? 0
        let fileSize = Int64(format["size"] as? String ?? "") ?? (try? Int64(FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int ?? 0)) ?? 0

        var t = Track(
            url: url,
            title:       tag("title", "TIT2"),
            artist:      tag("artist", "TPE1"),
            album:       tag("album", "TALB"),
            year:        tag("date", "TDRC", "TYER"),
            trackNumber: trackNum,
            totalTracks: totalTracks,
            bpm:         tag("TBPM", "bpm"),
            key:         tag("TKEY", "key", "initialkey"),
            genre:       tag("genre", "TCON"),
            comment:     tag("comment", "COMM", "n"),
            duration:    duration,
            fileSize:    fileSize
        )

        t.rating = Int(tag("TXXX:RATING", "rating", "RATING")) ?? 0
        t.dateAdded = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .distantPast
        t.ignoredProblems = IgnoreService.load(for: url)
        t.problems = ValidationService.detect(track: t)
        return t
    }

    nonisolated func readCoverArt(from url: URL) async -> NSImage? {
        let asset = AVURLAsset(url: url)
        do {
            let items = try await asset.load(.commonMetadata)
            for item in items where item.commonKey?.rawValue == "artwork" {
                if let data = try? await item.load(.dataValue) {
                    return NSImage(data: data)
                }
            }
        } catch {}
        return nil
    }

    private static func makeEmptyTrack(url: URL) -> Track {
        var t = Track(
            url: url,
            title: "", artist: "", album: "", year: "",
            trackNumber: "", totalTracks: "",
            bpm: "", key: "", genre: "", comment: "",
            duration: 0, fileSize: 0
        )
        t.ignoredProblems = IgnoreService.load(for: url)
        t.dateAdded = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .distantPast
        t.problems = ValidationService.detect(track: t)
        return t
    }

    private func collectMP3URLs(in folder: URL, recursive: Bool) throws -> [URL] {
        let fm = FileManager.default
        if recursive {
            guard let enumerator = fm.enumerator(
                at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]) else { return [] }
            return (enumerator.allObjects as? [URL] ?? [])
                .filter { $0.pathExtension.lowercased() == "mp3" }
                .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        } else {
            let contents = try fm.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles])
            return contents
                .filter { $0.pathExtension.lowercased() == "mp3" }
                .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
        }
    }
}
