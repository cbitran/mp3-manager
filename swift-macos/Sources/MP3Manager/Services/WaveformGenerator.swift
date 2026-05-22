import AVFoundation
import Foundation

// MARK: - Data

struct WaveformBar: Sendable {
    let amplitude: Float  // altura da barra (0-1)
    let low:       Float  // energia de baixas frequências → vermelho
    let mid:       Float  // energia das médias → verde
    let high:      Float  // energia das altas → azul
}

// MARK: - Cache & Throttle

actor WaveformCache {
    static let shared = WaveformCache()
    private var cache: [URL: [WaveformBar]] = [:]

    func get(_ url: URL) -> [WaveformBar]? { cache[url] }
    func store(_ url: URL, data: [WaveformBar]) { cache[url] = data }
}

// Limita AVAssetReader simultâneos para evitar saturação de I/O
actor WaveformThrottle {
    static let shared = WaveformThrottle()
    private var slots = 3
    private var queue: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        guard slots > 0 else {
            await withCheckedContinuation { queue.append($0) }
            return
        }
        slots -= 1
    }

    func release() {
        if let next = queue.first {
            queue.removeFirst()
            next.resume()
        } else {
            slots += 1
        }
    }
}

// MARK: - Generator

enum WaveformGenerator {

    private static let targetSampleRate: Double = 44100.0

    static func generate(url: URL, samples: Int = 200) async -> [WaveformBar] {
        if let cached = await WaveformCache.shared.get(url) { return cached }
        await WaveformThrottle.shared.acquire()
        let result = await _read(url: url, samples: samples)
        await WaveformThrottle.shared.release()
        if !result.isEmpty {
            await WaveformCache.shared.store(url, data: result)
        }
        return result
    }

    private static func _read(url: URL, samples: Int) async -> [WaveformBar] {
        let asset = AVURLAsset(url: url)
        guard let assetTrack = try? await asset.loadTracks(withMediaType: .audio).first else { return [] }
        guard let reader = try? AVAssetReader(asset: asset) else { return [] }

        // Força sample rate conhecido para coeficientes de filtro consistentes
        let outputSettings: [String: Any] = [
            AVFormatIDKey:           Int(kAudioFormatLinearPCM),
            AVLinearPCMBitDepthKey:  16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey:   false,
            AVNumberOfChannelsKey:   1,
            AVSampleRateKey:         targetSampleRate,
        ]

        let output = AVAssetReaderTrackOutput(track: assetTrack, outputSettings: outputSettings)
        output.alwaysCopiesSampleData = false
        reader.add(output)
        guard reader.startReading() else { return [] }

        var rawSamples: [Int16] = []

        while reader.status == .reading {
            guard let sampleBuffer = output.copyNextSampleBuffer() else { break }
            if let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) {
                let length = CMBlockBufferGetDataLength(blockBuffer)
                let count  = length / MemoryLayout<Int16>.size
                var chunk  = [Int16](repeating: 0, count: count)
                CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: &chunk)
                rawSamples.append(contentsOf: chunk)
            }
            CMSampleBufferInvalidate(sampleBuffer)
        }
        reader.cancelReading()

        guard !rawSamples.isEmpty else { return [] }

        // Coeficientes IIR (filtro passa-baixa de 1 polo) calculados em Double para precisão
        let fs = targetSampleRate
        let alphaLow  = Float(1.0 - exp(-2.0 * .pi * 300.0  / fs))  // 300 Hz  → grave
        let alphaMid  = Float(1.0 - exp(-2.0 * .pi * 3500.0 / fs))  // 3.5 kHz → médio
        let alphaHigh = Float(1.0 - exp(-2.0 * .pi * 8000.0 / fs))  // 8 kHz   → agudo

        let chunkSize = max(1, rawSamples.count / samples)
        var bars: [WaveformBar] = []
        bars.reserveCapacity(samples)

        // Estado dos filtros IIR (persistente entre amostras para continuidade)
        var yLow: Float = 0, yMid: Float = 0, yHigh: Float = 0

        for i in 0..<samples {
            let start = i * chunkSize
            let end   = min(start + chunkSize, rawSamples.count)
            guard start < rawSamples.count else {
                bars.append(WaveformBar(amplitude: 0, low: 0, mid: 0, high: 0))
                continue
            }

            var sumSq:   Float = 0
            var sumLow:  Float = 0
            var sumMid:  Float = 0
            var sumHigh: Float = 0

            for j in start..<end {
                let x    = Float(rawSamples[j]) / 32768.0
                let xAbs = abs(x)

                // Filtros IIR: envelope de cada banda
                yLow  = alphaLow  * xAbs + (1 - alphaLow)  * yLow
                yMid  = alphaMid  * xAbs + (1 - alphaMid)  * yMid
                yHigh = alphaHigh * xAbs + (1 - alphaHigh) * yHigh

                sumSq   += x * x
                sumLow  += yLow
                sumMid  += max(0, yMid  - yLow)                        // banda 300 Hz – 3.5 kHz
                sumHigh += max(0, yHigh - yMid) + max(0, xAbs - yHigh) * 0.5  // 3.5 kHz+
            }

            let n = Float(end - start)
            bars.append(WaveformBar(
                amplitude: sqrt(sumSq / n),
                low:  sumLow  / n,
                mid:  sumMid  / n,
                high: sumHigh / n
            ))
        }

        // Normaliza amplitude pelo percentil 80 (picos reais chegam ao topo, média fica no meio)
        let sortedAmp = bars.map(\.amplitude).sorted()
        let p80amp    = sortedAmp[min(Int(Float(sortedAmp.count) * 0.80), sortedAmp.count - 1)]
        let ampScale  = p80amp > 0 ? Float(0.72) / p80amp : 1.0

        // Normaliza cada banda de frequência independentemente
        let maxLow  = bars.map(\.low).max()  ?? 1
        let maxMid  = bars.map(\.mid).max()  ?? 1
        let maxHigh = bars.map(\.high).max() ?? 1

        return bars.map {
            WaveformBar(
                amplitude: min(1.0, $0.amplitude * ampScale),
                low:  maxLow  > 0 ? min(1.0, $0.low  / maxLow)  : 0,
                mid:  maxMid  > 0 ? min(1.0, $0.mid  / maxMid)  : 0,
                high: maxHigh > 0 ? min(1.0, $0.high / maxHigh) : 0
            )
        }
    }
}
