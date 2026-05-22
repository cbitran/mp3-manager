import Foundation
import AVFoundation

@MainActor
@Observable
final class AudioPlayerService: NSObject, AVAudioPlayerDelegate {
    static let shared = AudioPlayerService()

    private var player: AVAudioPlayer?
    private var timer: Timer?

    var currentURL: URL?
    var isPlaying: Bool = false
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0

    var progress: Double {
        duration > 0 ? currentTime / duration : 0
    }

    var formattedCurrent: String { timeString(currentTime) }
    var formattedDuration: String { timeString(duration) }

    // MARK: - Controls

    func load(_ url: URL) {
        guard url != currentURL else { return }
        stopInternal()
        do {
            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            player?.prepareToPlay()
            duration = player?.duration ?? 0
            currentURL = url
            currentTime = 0
        } catch {
            player = nil
        }
    }

    func playPause() {
        guard let p = player else { return }
        if p.isPlaying {
            p.pause()
            isPlaying = false
            stopTimer()
        } else {
            p.play()
            isPlaying = true
            startTimer()
        }
    }

    func seek(to fraction: Double) {
        guard let p = player else { return }
        let t = max(0, min(1, fraction)) * duration
        p.currentTime = t
        currentTime = t
    }

    func stop() {
        stopInternal()
        currentURL = nil
    }

    // MARK: - Private

    private func stopInternal() {
        player?.stop()
        player = nil
        isPlaying = false
        currentTime = 0
        duration = 0
        stopTimer()
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        guard let p = player else { return }
        currentTime = p.currentTime
        if !p.isPlaying {
            isPlaying = false
            stopTimer()
        }
    }

    private func timeString(_ t: TimeInterval) -> String {
        let total = Int(max(0, t))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: - AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.currentTime = 0
            self.stopTimer()
        }
    }
}
