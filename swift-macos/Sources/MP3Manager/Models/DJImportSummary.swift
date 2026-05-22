import Foundation

struct DJImportSummary {
    var totalTracks: Int
    var foundInSerato: Int
    var foundInRekordbox: Int
    var withCuePoints: Int
    var withBPM: Int
    var notFound: Int

    var foundTotal: Int { foundInSerato + foundInRekordbox }
    var successRate: Double { totalTracks > 0 ? Double(foundTotal) / Double(totalTracks) : 0 }
}
