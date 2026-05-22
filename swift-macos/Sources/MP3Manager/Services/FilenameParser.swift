import Foundation

struct FilenameParser {

    static func parse(filename: String) -> ParsedTags? {
        var name = (filename as NSString).deletingPathExtension

        // Strip SpotiDownloader prefix
        let spotiPrefix = "SpotiDownloader.com - "
        if name.hasPrefix(spotiPrefix) {
            name = String(name.dropFirst(spotiPrefix.count))
        }

        name = name.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return nil }

        // Pattern: "NN - Title"  or  "Artist - Title"
        // Find FIRST " - " separator
        if let dashRange = name.range(of: " - ") {
            let left  = String(name[..<dashRange.lowerBound]).trimmingCharacters(in: .whitespaces)
            let right = String(name[dashRange.upperBound...]).trimmingCharacters(in: .whitespaces)

            // Left looks like a track number?
            let looksLikeNumber = left.count <= 3 && left.allSatisfy({ $0.isNumber || $0 == "." })
            if looksLikeNumber {
                return ParsedTags(artist: "", title: right, trackNumber: left.filter({ $0.isNumber }), confidence: 0.65)
            }

            // Standard "Artist - Title"
            return ParsedTags(artist: left, title: right, trackNumber: "", confidence: 0.88)
        }

        // No separator: whole name becomes the title
        return ParsedTags(artist: "", title: name, trackNumber: "", confidence: 0.50)
    }

    // Returns true if the track is missing tags AND the filename has parseable info
    static func canPopulate(track: Track) -> Bool {
        guard track.title.isEmpty || track.artist.isEmpty else { return false }
        guard let p = parse(filename: track.filename) else { return false }
        return !p.title.isEmpty || !p.artist.isEmpty
    }
}
