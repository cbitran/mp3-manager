import Foundation

struct DJData: Equatable {
    var source: DJSource
    var bpm: String
    var key: String
    var rating: Int        // 0–5
    var color: String      // hex "#RRGGBB"
    var playCount: Int
    var cues: [CuePoint]
    var loops: [CueLoop]
    var hasBeatGrid: Bool
    var hasOverview: Bool
    var isWrittenToTags: Bool = false
}

enum DJSource: String, Equatable {
    case serato     = "Serato"
    case rekordbox  = "Rekordbox"
    case universal  = "Universal"
}

struct CuePoint: Identifiable, Equatable {
    var id: UUID = UUID()
    var index: Int
    var positionMs: Int
    var name: String
    var color: String
    var isHot: Bool = false
}

struct CueLoop: Identifiable, Equatable {
    var id: UUID = UUID()
    var index: Int
    var inMs: Int
    var outMs: Int
    var name: String

    var durationMs: Int { outMs - inMs }
    var durationBeats: String {
        if durationMs <= 0 { return "" }
        return "\(durationMs)ms"
    }
}
