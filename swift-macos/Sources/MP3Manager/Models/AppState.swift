import Foundation
import SwiftUI

@Observable
class AppState {
    private static let kLastFolder     = "mp3mgr_lastFolder"
    private static let kRecent         = "mp3mgr_recentFolders"
    private static let kFavorites      = "mp3mgr_favoriteFolders"
    private static let kFavoriteTracks = "mp3mgr_favoriteTracks"
    private static let kLibraryPath    = "mp3mgr_libraryRootPath"

    var recentFolders: [URL] = [] {
        didSet { UserDefaults.standard.set(recentFolders.map(\.path), forKey: Self.kRecent) }
    }
    var favoriteFolders: [URL] = [] {
        didSet { UserDefaults.standard.set(favoriteFolders.map(\.path), forKey: Self.kFavorites) }
    }

    var favoriteTrackPaths: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "mp3mgr_favoriteTracks") ?? []) {
        didSet { UserDefaults.standard.set(Array(favoriteTrackPaths), forKey: Self.kFavoriteTracks) }
    }

    var libraryRootPath: String = UserDefaults.standard.string(forKey: "mp3mgr_libraryRootPath") ?? "" {
        didSet {
            UserDefaults.standard.set(libraryRootPath, forKey: Self.kLibraryPath)
            libraryTracks = []  // invalida índice ao mudar o caminho
        }
    }
    var libraryTracks: [Track] = []
    var isIndexingLibrary: Bool = false
    var libraryIndexDone: Int = 0
    var libraryIndexTotal: Int = 0

    func isTrackFavorite(_ url: URL) -> Bool { favoriteTrackPaths.contains(url.path) }

    func toggleTrackFavorite(_ url: URL) {
        let path = url.path
        if favoriteTrackPaths.contains(path) { favoriteTrackPaths.remove(path) }
        else { favoriteTrackPaths.insert(path) }
    }
    var selectedFolder: URL? {
        didSet {
            if let url = selectedFolder {
                UserDefaults.standard.set(url.path, forKey: Self.kLastFolder)
            }
        }
    }

    var lastPersistedFolder: URL? {
        guard let path = UserDefaults.standard.string(forKey: Self.kLastFolder),
              FileManager.default.fileExists(atPath: path) else { return nil }
        return URL(fileURLWithPath: path)
    }

    func restorePersistedFolders() {
        let ud = UserDefaults.standard
        let recentPaths = ud.stringArray(forKey: Self.kRecent) ?? []
        recentFolders = recentPaths.compactMap { path -> URL? in
            FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
        }
        let favPaths = ud.stringArray(forKey: Self.kFavorites) ?? []
        favoriteFolders = favPaths.compactMap { path -> URL? in
            FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
        }
    }
    var tracks: [Track] = [] {
        didSet {
            if tracks.isEmpty && !oldValue.isEmpty {
                cancelRunningTasks()
            }
        }
    }
    var selectedTrackIds: Set<Track.ID> = []

    var selectedTrackId: Track.ID? {
        get { selectedTrackIds.count == 1 ? selectedTrackIds.first : nil }
        set {
            if let id = newValue { selectedTrackIds = [id] }
            else { selectedTrackIds = [] }
        }
    }
    var isScanning: Bool = false
    var scanProgress: Double = 0
    var scanDone: Int = 0
    var scanTotal: Int = 0
    var statusMessage: String = "Pronto — abra uma pasta para começar"
    var isSaving: Bool = false

    // Scan preview (mostrado antes de confirmar)
    var pendingScanURL: URL?
    var scanPreview: FolderScanPreview?
    var isShowingScanPreview: Bool = false

    // Fila de revisão manual
    var reviewQueue: [ReviewItem] = []
    var isShowingReviewQueue: Bool = false

    // Log de correções automáticas
    var batchLog: [BatchLogEntry] = []
    var isShowingBatchResults: Bool = false

    // Progresso de validação em lote (metadata)
    var batchProgress: Double = 0
    var batchTotal: Int = 0
    var batchDone: Int = 0
    var batchCurrent: String = ""
    var isBatchRunning: Bool = false

    // Popular tags a partir do nome de arquivo (pós-scan)
    var isShowingFilenameTagPrompt: Bool = false

    // Validação DJ pós-scan
    var isShowingDJValidationPrompt: Bool = false
    var djValidationFolderName: String = ""

    // Prompt de metadados ausentes pós-scan
    var isShowingMissingMetaPrompt: Bool = false
    var missingMetaSummary: MissingMetaSummary?

    // Análise de BPM em lote (IA)
    var isBatchBPMRunning: Bool = false
    var batchBPMProgress: Double = 0
    var batchBPMCurrent: String = ""
    var batchBPMCurrentId: Track.ID? = nil
    var batchBPMActiveIds: Set<Track.ID> = []
    var batchBPMDone: Int = 0
    var batchBPMTotal: Int = 0
    var batchBPMResults: [BatchBPMEntry] = []
    var isShowingBatchBPMResults: Bool = false

    // Progresso de importação DJ em lote
    var isDJImporting: Bool = false
    var djImportProgress: Double = 0
    var djImportCurrent: String = ""
    var djImportTotal: Int = 0
    var djImportDone: Int = 0
    var djImportResults: DJImportSummary?
    var isShowingDJImportResults: Bool = false

    // Assistente de busca musical
    var isShowingAssistant: Bool = false

    // Task do batch BPM (para cancelamento)
    var batchBPMTask: Task<Void, Never>? = nil

    // Detecção de duplicatas
    var duplicateGroups: [DuplicateGroup] = []
    var isDuplicateScanning: Bool = false
    var isShowingDuplicates: Bool = false

    // Exportar para pasta
    var isShowingExport: Bool = false

    // Navegação pendente após carregar pasta (ex: "Ir para" do Assistente)
    var pendingNavigationURL: URL? = nil

    // Enriquecimento via Spotify (BPM + Tom)
    var isSpotifyEnriching: Bool = false
    var spotifyEnrichDone: Int = 0
    var spotifyEnrichTotal: Int = 0
    var spotifyEnrichCurrent: String = ""
    var spotifyEnrichTask: Task<Void, Never>? = nil
    var spotifyEnrichProgress: Double { spotifyEnrichTotal > 0 ? Double(spotifyEnrichDone) / Double(spotifyEnrichTotal) : 0 }

    // Enriquecimento via iTunes (gênero + ano + álbum)
    var isITunesEnriching: Bool = false
    var iTunesEnrichDone: Int = 0
    var iTunesEnrichTotal: Int = 0
    var iTunesEnrichCurrent: String = ""
    var iTunesEnrichTask: Task<Void, Never>? = nil
    var iTunesEnrichProgress: Double { iTunesEnrichTotal > 0 ? Double(iTunesEnrichDone) / Double(iTunesEnrichTotal) : 0 }

    // Enriquecimento via Last.fm (gênero por crowdsourcing)
    var isLastFMEnriching: Bool = false
    var lastFMEnrichDone: Int = 0
    var lastFMEnrichTotal: Int = 0
    var lastFMEnrichCurrent: String = ""
    var lastFMEnrichTask: Task<Void, Never>? = nil
    var lastFMEnrichProgress: Double { lastFMEnrichTotal > 0 ? Double(lastFMEnrichDone) / Double(lastFMEnrichTotal) : 0 }

    // Enriquecimento de metadados (MusicBrainz)
    var isEnriching: Bool = false
    var enrichDone: Int = 0
    var enrichTotal: Int = 0
    var enrichCurrent: String = ""
    var enrichCurrentId: Track.ID? = nil
    var enrichResults: [MetadataEnrichResult] = []
    var isShowingEnrichResults: Bool = false
    var enrichTask: Task<Void, Never>? = nil

    var enrichProgress: Double {
        enrichTotal > 0 ? Double(enrichDone) / Double(enrichTotal) : 0
    }

    var selectedTrack: Track? {
        get { tracks.first(where: { $0.id == selectedTrackId }) }
        set {
            guard let t = newValue, let idx = tracks.firstIndex(where: { $0.id == t.id }) else { return }
            tracks[idx] = t
        }
    }

    var problemTracks: [Track] { tracks.filter { $0.hasProblems } }
    var cleanTracks: [Track] { tracks.filter { !$0.hasProblems } }

    func cancelRunningTasks() {
        batchBPMTask?.cancel()
        batchBPMTask = nil
        isBatchBPMRunning = false
        batchBPMActiveIds = []
        batchBPMDone = 0; batchBPMTotal = 0; batchBPMProgress = 0

        enrichTask?.cancel()
        enrichTask = nil
        isEnriching = false
        enrichDone = 0; enrichTotal = 0

        spotifyEnrichTask?.cancel()
        spotifyEnrichTask = nil
        isSpotifyEnriching = false
        spotifyEnrichDone = 0; spotifyEnrichTotal = 0

        iTunesEnrichTask?.cancel()
        iTunesEnrichTask = nil
        isITunesEnriching = false
        iTunesEnrichDone = 0; iTunesEnrichTotal = 0

        lastFMEnrichTask?.cancel()
        lastFMEnrichTask = nil
        isLastFMEnriching = false
        lastFMEnrichDone = 0; lastFMEnrichTotal = 0

        // Limpa todo estado derivado das tracks
        duplicateGroups = []
        isDuplicateScanning = false
        reviewQueue = []
        batchLog = []
        enrichResults = []
        selectedTrackIds = []
        statusMessage = "Pronto — abra uma pasta para começar"
    }

    func updateTrack(_ track: Track) {
        guard let idx = tracks.firstIndex(where: { $0.id == track.id }) else { return }
        tracks[idx] = track
    }

    func addRecentFolder(_ url: URL) {
        recentFolders.removeAll(where: { $0 == url })
        recentFolders.insert(url, at: 0)
        if recentFolders.count > 10 { recentFolders = Array(recentFolders.prefix(10)) }
    }

    func removeRecentFolder(_ url: URL) {
        recentFolders.removeAll(where: { $0 == url })
    }

    func isFavorite(_ url: URL) -> Bool { favoriteFolders.contains(url) }

    func toggleFavorite(_ url: URL) {
        if favoriteFolders.contains(url) {
            favoriteFolders.removeAll(where: { $0 == url })
        } else {
            favoriteFolders.insert(url, at: 0)
        }
    }
}

struct BatchBPMEntry: Identifiable {
    var id = UUID()
    var filename: String
    var bpm: String?
    var error: String?
    var success: Bool { bpm != nil }
}

struct MissingMetaSummary {
    var missingGenre: Int
    var missingYear:  Int
    var missingAlbum: Int
    var missingBPM:   Int
    var total:        Int
}
