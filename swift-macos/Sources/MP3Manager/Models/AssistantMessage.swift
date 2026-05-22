import Foundation

struct AssistantMessage: Identifiable {
    var id = UUID()

    enum Role { case user, assistant }

    var role: Role
    var text: String
    var results: [Track]?
    var timestamp: Date = Date()
}
