import Foundation

struct Track: Identifiable, Equatable {
    var id: UUID = UUID()
    var url: URL

    var title: String
    var artist: String
    var album: String
    var year: String
    var trackNumber: String
    var totalTracks: String
    var bpm: String
    var key: String
    var genre: String
    var comment: String
    var duration: Double   // segundos
    var fileSize: Int64    // bytes

    var rating: Int = 0                   // 0 = sem avaliação, 1–5 estrelas
    var coverVersion: Int = 0             // incrementado após salvar capa — força reload na tabela
    var dateAdded: Date = .distantPast    // data de criação do arquivo
    var ignoredProblems: Set<String> = [] // problemas suprimidos pelo usuário

    var problems: [TrackProblem] = []
    var validationResult: MusicBrainzResult?
    var discogsResult: MetadataMatch?
    var isValidating: Bool = false
    var djData: DJData?

    var filename: String { url.lastPathComponent }
    var fileType: String { url.pathExtension.uppercased() }
    var hasProblems: Bool { !problems.isEmpty }

    var problemSeverity: ProblemSeverity {
        if problems.isEmpty { return .none }
        if problems.contains(where: { $0.severity == .error }) { return .error }
        return .warning
    }

    var expectedFilename: String {
        let a = artist.isEmpty ? "Desconhecido" : artist
        let t = title.isEmpty ? "Sem Título" : title
        // Preserva prefixo numérico do arquivo atual (ex: "21. ")
        var prefix = ""
        if let range = filename.range(of: #"^\d+\. "#, options: .regularExpression) {
            prefix = String(filename[range])
        }
        let safe = "\(prefix)\(a) - \(t).mp3"
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return safe
    }
}

enum ProblemSeverity: Comparable {
    case none, warning, error
}

enum TrackProblem: Hashable {
    case wrongYear(String)
    case missingTitle
    case missingArtist
    case missingAlbum
    case spotidownloaderOrigin
    case filenameInconsistent(expected: String)

    var key: String {
        switch self {
        case .wrongYear:              return "wrongYear"
        case .missingTitle:           return "missingTitle"
        case .missingArtist:          return "missingArtist"
        case .missingAlbum:           return "missingAlbum"
        case .spotidownloaderOrigin:  return "spotidownloaderOrigin"
        case .filenameInconsistent:   return "filenameInconsistent"
        }
    }

    var severity: ProblemSeverity {
        switch self {
        case .missingTitle, .missingArtist: return .error
        default: return .warning
        }
    }

    var description: String {
        switch self {
        case .wrongYear(let y): return "Ano suspeito: \(y) (provável 1970 incorreto)"
        case .missingTitle: return "Título vazio"
        case .missingArtist: return "Artista vazio"
        case .missingAlbum: return "Álbum vazio"
        case .spotidownloaderOrigin: return "Baixado via SpotiDownloader"
        case .filenameInconsistent(let exp): return "Arquivo deveria ser: \(exp)"
        }
    }

    var icon: String {
        switch severity {
        case .error: return "xmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .none: return "checkmark.circle.fill"
        }
    }
}

struct MusicBrainzResult: Equatable {
    var mbTitle: String
    var mbArtist: String
    var mbAlbum: String
    var mbYear: String
    var score: Int
    var recordingId: String

    var titleMatch: Bool
    var artistMatch: Bool
    var albumMatch: Bool
    var yearMatch: Bool

    var isFullMatch: Bool { titleMatch && artistMatch }
}

struct MetadataEnrichResult: Identifiable {
    var id = UUID()
    var trackId: Track.ID
    var filename: String
    var appliedGenre: String?
    var appliedYear: String?
    var appliedAlbum: String?
    var score: Int
    var skipped: Bool = false

    var enriched: Bool { appliedGenre != nil || appliedYear != nil || appliedAlbum != nil }
}
