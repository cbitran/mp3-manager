import Foundation

enum MetadataSource: String, CaseIterable {
    case musicBrainz = "MusicBrainz"
    case discogs     = "Discogs"
    case acoustID    = "AcoustID"
    case spotify     = "Spotify"
    case lastFM      = "Last.fm"
}

struct MetadataMatch: Identifiable, Equatable {
    var id: UUID = UUID()
    var source: MetadataSource
    var title: String
    var artist: String
    var album: String
    var year: String
    var trackNumber: String
    var genre: String
    var label: String
    var country: String
    var score: Int
    var externalId: String
    var coverArtURL: String = ""
    var bpm: String = ""
    var key: String = ""

    var isHighConfidence: Bool { score >= 90 }
}

struct ReviewItem: Identifiable {
    var id: UUID = UUID()
    var track: Track
    var matches: [MetadataMatch]
    var chosen: MetadataMatch?
    var isSkipped: Bool = false
    var isResolved: Bool { chosen != nil || isSkipped }
}

struct BatchLogEntry: Identifiable {
    var id: UUID = UUID()
    var filename: String
    var changes: [(field: String, from: String, to: String)]
    var source: MetadataSource
    var timestamp: Date = Date()
}

struct FolderScanPreview {
    struct FolderInfo: Identifiable {
        var id: URL { url }
        var url: URL
        var name: String
        var mp3Count: Int
        var subfolders: [FolderInfo]
        var totalCount: Int { mp3Count + subfolders.reduce(0) { $0 + $1.totalCount } }
    }

    var root: FolderInfo
    var totalFolders: Int
    var totalFiles: Int
}

// MARK: - DJ Preferences

enum DJSoftwarePreference: String, CaseIterable, Identifiable {
    case serato    = "Serato"
    case rekordbox = "Rekordbox"
    case both      = "Ambos"
    case none      = "Não uso software DJ"
    var id: String { rawValue }

    var icon: String {
        switch self {
        case .serato:    return "waveform"
        case .rekordbox: return "record.circle"
        case .both:      return "music.note.list"
        case .none:      return "minus.circle"
        }
    }
}

struct DJConsensusField: Identifiable {
    var id: String
    var label: String
    var entries: [(source: String, value: String)]
    var preferredValue: String    // valor da fonte principal
    var chosenValue: String       // valor que o usuário escolheu (ou o consenso)

    var uniqueValues: [String] { Array(Set(entries.map { $0.value.trimmingCharacters(in: .whitespaces) }).filter { !$0.isEmpty }) }
    var hasConsensus: Bool { uniqueValues.count <= 1 }
    var confidence: Double {
        guard !entries.isEmpty else { return 0 }
        let dominant = entries.filter { $0.value == uniqueValues.first ?? "" }.count
        return Double(dominant) / Double(entries.count)
    }
}

struct DJConsensus {
    var fields: [DJConsensusField]
    var primarySource: String
    var allSources: [String]

    func field(_ id: String) -> DJConsensusField? { fields.first(where: { $0.id == id }) }
}

// MARK: - API Keys + DJ Settings

struct APIKeys {
    static let discogsKey           = "apikey.discogs"
    static let acoustIDKey          = "apikey.acoustid"
    static let spotifyClientIdKey   = "apikey.spotify.clientId"
    static let spotifyClientSecKey  = "apikey.spotify.clientSecret"
    static let lastFMApiKeyKey      = "apikey.lastfm"
    static let djPrimaryKey         = "dj.primarySoftware"
    static let djAutoImportKey      = "dj.autoImport"
    static let djShowAllKey         = "dj.showAllSources"
    static let djUseRekordboxKey    = "dj.useRekordbox"
    static let djUseSeratoKey       = "dj.useSerato"

    static var discogs: String        { UserDefaults.standard.string(forKey: discogsKey)          ?? "" }
    static var acoustID: String       { UserDefaults.standard.string(forKey: acoustIDKey)         ?? "" }
    static var spotifyClientId: String     { UserDefaults.standard.string(forKey: spotifyClientIdKey)  ?? "" }
    static var spotifyClientSecret: String { UserDefaults.standard.string(forKey: spotifyClientSecKey) ?? "" }
    static var lastFMApiKey: String   { UserDefaults.standard.string(forKey: lastFMApiKeyKey)     ?? "" }

    static var djPrimary: DJSoftwarePreference {
        let raw = UserDefaults.standard.string(forKey: djPrimaryKey) ?? ""
        return DJSoftwarePreference(rawValue: raw) ?? .none
    }
    static var djAutoImport: Bool { UserDefaults.standard.bool(forKey: djAutoImportKey) }
    static var djShowAll: Bool    { UserDefaults.standard.bool(forKey: djShowAllKey) }
    static var djUseRekordbox: Bool {
        let pref = djPrimary
        if pref == .rekordbox || pref == .both { return true }
        return UserDefaults.standard.bool(forKey: djUseRekordboxKey)
    }
    static var djUseSerato: Bool {
        let pref = djPrimary
        if pref == .serato || pref == .both { return true }
        return UserDefaults.standard.bool(forKey: djUseSeratoKey)
    }

    static func save(discogs: String, acoustID: String) {
        UserDefaults.standard.set(discogs,  forKey: discogsKey)
        UserDefaults.standard.set(acoustID, forKey: acoustIDKey)
    }

    static func saveSpotify(clientId: String, clientSecret: String) {
        UserDefaults.standard.set(clientId,     forKey: spotifyClientIdKey)
        UserDefaults.standard.set(clientSecret, forKey: spotifyClientSecKey)
    }

    static func saveLastFM(apiKey: String) {
        UserDefaults.standard.set(apiKey, forKey: lastFMApiKeyKey)
    }

    static func saveDJPrefs(primary: DJSoftwarePreference, autoImport: Bool, showAll: Bool) {
        UserDefaults.standard.set(primary.rawValue, forKey: djPrimaryKey)
        UserDefaults.standard.set(autoImport,       forKey: djAutoImportKey)
        UserDefaults.standard.set(showAll,          forKey: djShowAllKey)
    }
}
