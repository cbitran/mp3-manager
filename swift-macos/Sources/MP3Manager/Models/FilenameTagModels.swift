import Foundation

struct ParsedTags {
    var artist: String
    var title: String
    var trackNumber: String
    var confidence: Double
}

struct FilenameTagCandidate: Identifiable {
    var id: UUID { track.id }
    var track: Track
    var parsed: ParsedTags
    var isSelected: Bool = true
}
