import SwiftUI

struct MiniPlayerView: View {
    let track: Track
    var showVinyl: Bool = true

    @State private var player = AudioPlayerService.shared
    @State private var isDragging = false
    @State private var dragFraction: Double = 0
    @State private var vinylDegrees: Double = 0

    private var isThisTrack: Bool { player.currentURL == track.url }
    private var displayProgress: Double { isDragging ? dragFraction : player.progress }
    private var isPlaying: Bool { isThisTrack && player.isPlaying }

    private let spinTimer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 12) {
            if showVinyl { vinyl }
            scrubber
            controls
        }
        .padding(.vertical, 4)
        .onAppear { player.load(track.url) }
        .onChange(of: track.url) { _, url in player.load(url) }
        .onReceive(spinTimer) { _ in
            guard isPlaying else { return }
            vinylDegrees = (vinylDegrees + 2.0).truncatingRemainder(dividingBy: 360)
        }
    }

    // MARK: - Vinyl Disc

    private var vinyl: some View {
        ZStack {
            // Disco externo
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(stops: [
                            .init(color: Color(white: 0.22), location: 0.0),
                            .init(color: Color(white: 0.12), location: 0.5),
                            .init(color: Color(white: 0.06), location: 1.0),
                        ]),
                        center: .center, startRadius: 8, endRadius: 52
                    )
                )
                .frame(width: 104, height: 104)
                .shadow(color: .black.opacity(0.55), radius: 10, x: 0, y: 4)

            // Ranhuras
            ForEach([32, 40, 46, 51, 55], id: \.self) { d in
                Circle()
                    .stroke(Color.white.opacity(0.04), lineWidth: 0.7)
                    .frame(width: CGFloat(d))
            }

            // Label central
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color.accentColor.opacity(0.9), Color.accentColor.opacity(0.55)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
                .frame(width: 34, height: 34)

            // Inicial do artista
            if !track.artist.isEmpty {
                Text(String(track.artist.prefix(1)).uppercased())
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
            }

            // Furo central
            Circle()
                .fill(Color.black.opacity(0.75))
                .frame(width: 6, height: 6)
        }
        .rotationEffect(.degrees(vinylDegrees))
        .scaleEffect(isPlaying ? 1.0 : 0.86)
        .opacity(isPlaying ? 1.0 : 0.55)
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: isPlaying)
    }

    // MARK: - Scrubber

    private var scrubber: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.12))
                    .frame(height: 4)

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color.accentColor, Color.accentColor.opacity(0.7)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(4, geo.size.width * displayProgress), height: 4)
                    .animation(isDragging ? nil : .linear(duration: 0.08), value: displayProgress)

                if isDragging {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 10, height: 10)
                        .offset(x: max(0, geo.size.width * dragFraction - 5))
                }
            }
            .frame(height: 18)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        isDragging = true
                        dragFraction = max(0, min(1, v.location.x / geo.size.width))
                    }
                    .onEnded { v in
                        player.seek(to: dragFraction)
                        isDragging = false
                    }
            )
        }
        .frame(height: 18)
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(alignment: .center) {
            Text(isThisTrack ? player.formattedCurrent : "0:00")
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .leading)
                .contentTransition(.numericText())
                .animation(.easeOut(duration: 0.08), value: player.formattedCurrent)

            Spacer()

            Button { player.seek(to: 0) } label: {
                Image(systemName: "backward.end.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .disabled(!isThisTrack)

            Button {
                if !isThisTrack { player.load(track.url) }
                player.playPause()
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.bounce, value: isPlaying)
            }
            .buttonStyle(.plain)

            Button { player.stop() } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .disabled(!isThisTrack)

            Spacer()

            Text(isThisTrack ? player.formattedDuration : "–:––")
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)
        }
    }
}
