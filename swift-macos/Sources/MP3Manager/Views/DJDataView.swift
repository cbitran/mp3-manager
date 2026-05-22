import SwiftUI

struct DJDataView: View {
    let track: Track
    @Environment(AppState.self) private var state

    @State private var seratoData:    DJData?
    @State private var rekordboxData: DJData?
    @State private var isLoadingSerato    = false
    @State private var isLoadingRekordbox = false
    @State private var isWriting          = false
    @State private var statusMsg: String?
    @State private var expanded = false

    @State private var aiResult: AIBPMResult?
    @State private var isAnalyzingAI = false
    @State private var aiExpanded = false

    private var primaryPref: DJSoftwarePreference { APIKeys.djPrimary }
    private var showAll: Bool { APIKeys.djShowAll || expanded }

    private var primaryData: DJData? {
        switch primaryPref {
        case .serato:    return seratoData
        case .rekordbox: return rekordboxData
        case .both:      return seratoData ?? rekordboxData
        case .none:      return seratoData ?? rekordboxData
        }
    }

    private var consensus: DJConsensus? {
        buildConsensus()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            headerRow

            if seratoData == nil && rekordboxData == nil {
                importArea
            } else {
                if showAll || consensus == nil {
                    allSourcesView
                } else {
                    consensusView
                }

                writeButton
            }

            aiAnalysisSection

            if let msg = statusMsg {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? Color.green : Color.orange)
            }
        }
        .onAppear {
            seratoData    = track.djData?.source == .serato    ? track.djData : nil
            rekordboxData = track.djData?.source == .rekordbox ? track.djData : nil
            if APIKeys.djAutoImport && track.djData == nil {
                Task { await autoLoad() }
            }
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack {
            Label("Dados DJ", systemImage: "dial.medium.fill")
                .font(.caption.bold()).foregroundStyle(.secondary)
            Spacer()
            if isLoadingSerato || isLoadingRekordbox {
                ProgressView().scaleEffect(0.6).frame(width: 14, height: 14)
            }
            if seratoData != nil || rekordboxData != nil {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    Text(expanded ? "Resumo" : "Ver tudo")
                        .font(.caption)
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Import buttons

    private var importArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if primaryPref == .none {
                Text("Configure o software DJ em Preferências (⌘,) para importar automaticamente.")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                DJImportButton(label: "Serato", icon: "waveform", color: .teal,
                               isLoading: isLoadingSerato, isPrimary: primaryPref == .serato || primaryPref == .both,
                               isLoaded: seratoData != nil) { importSerato() }

                DJImportButton(label: "Rekordbox", icon: "record.circle", color: .red,
                               isLoading: isLoadingRekordbox, isPrimary: primaryPref == .rekordbox || primaryPref == .both,
                               isLoaded: rekordboxData != nil) { importRekordbox() }
            }
        }
    }

    // MARK: - Consensus view (modo resumido)

    @ViewBuilder
    private var consensusView: some View {
        if let c = consensus {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(c.fields) { field in
                    ConsensusRow(field: field, primarySource: c.primarySource) { chosen in
                        applyField(field.id, value: chosen)
                    }
                }

                if !c.allSources.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(c.allSources, id: \.self) { src in
                            SourcePill(name: src, isPrimary: src == c.primarySource)
                        }
                        Spacer()
                    }
                }

                cuesAndLoopsSummary
            }
        }
    }

    // MARK: - All sources view (modo expandido)

    @ViewBuilder
    private var allSourcesView: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let s = seratoData {
                SourcePanel(data: s, isPrimary: primaryPref == .serato || primaryPref == .both,
                            onSelect: { field, val in applyField(field, value: val) })
            }
            if let r = rekordboxData {
                SourcePanel(data: r, isPrimary: primaryPref == .rekordbox || primaryPref == .both,
                            onSelect: { field, val in applyField(field, value: val) })
            }
        }
    }

    @ViewBuilder
    private var cuesAndLoopsSummary: some View {
        let allCues  = (seratoData?.cues ?? []) + (rekordboxData?.cues ?? [])
        let allLoops = (seratoData?.loops ?? []) + (rekordboxData?.loops ?? [])

        if !allCues.isEmpty || !allLoops.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if !allCues.isEmpty {
                    Text("CUE POINTS").font(.caption2.bold()).foregroundStyle(.secondary)
                    ForEach(allCues.prefix(8)) { cue in CueRow(cue: cue) }
                }
                if !allLoops.isEmpty {
                    Text("LOOPS").font(.caption2.bold()).foregroundStyle(.secondary)
                    ForEach(allLoops.prefix(4)) { loop in LoopRow(loop: loop) }
                }
            }
        }
    }

    // MARK: - AI BPM Analysis

    @ViewBuilder
    private var aiAnalysisSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Análise com IA", systemImage: "waveform.badge.magnifyingglass")
                    .font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                if isAnalyzingAI {
                    ProgressView().scaleEffect(0.6).frame(width: 14, height: 14)
                }
                if aiResult != nil {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { aiExpanded.toggle() }
                    } label: {
                        Image(systemName: aiExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let ai = aiResult, aiExpanded {
                AIBPMResultView(ai: ai,
                                seratoBPM: seratoData?.bpm,
                                rekordboxBPM: rekordboxData?.bpm) {
                    writeAIBPM()
                }
            }

            if aiResult == nil {
                Button {
                    Task { await runAIAnalysis() }
                } label: {
                    Label(isAnalyzingAI ? "Analisando…" : "Analisar BPM com IA",
                          systemImage: "waveform.badge.magnifyingglass")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.purple)
                .disabled(isAnalyzingAI)
            } else if !aiExpanded {
                HStack(spacing: 8) {
                    if let ai = aiResult {
                        Label(ai.bpmStr, systemImage: "metronome.fill")
                            .font(.callout.bold())
                        Text("BPM (IA · \(Int(ai.confidence * 100))% conf.)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Ver detalhes") { withAnimation { aiExpanded = true } }
                        .font(.caption).buttonStyle(.plain).foregroundStyle(.blue)
                }
            }
        }
        .padding(10)
        .background(Color.purple.opacity(0.05))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.purple.opacity(0.15), lineWidth: 1))
        .cornerRadius(8)
    }

    private func runAIAnalysis() async {
        await MainActor.run { isAnalyzingAI = true; statusMsg = nil }
        do {
            let result = try await AIBPMService.shared.analyze(track: track)
            await MainActor.run {
                aiResult   = result
                aiExpanded = true
                statusMsg  = "✓ IA: \(result.bpmStr) BPM (\(Int(result.confidence * 100))% confiança)"
            }
        } catch {
            await MainActor.run { statusMsg = "IA: \(error.localizedDescription)" }
        }
        await MainActor.run { isAnalyzingAI = false }
    }

    private func writeAIBPM() {
        isWriting = true
        Task {
            do {
                let result = try await AIBPMService.shared.analyzeAndWrite(track: track)
                var updated = track
                updated.bpm = result.bpmStr
                if let k = result.key, !k.isEmpty { updated.key = k }
                if let cues = result.cuePoints, !cues.isEmpty {
                    let djd = AIBPMService.shared.applyAICues(
                        cues, to: updated.djData,
                        bpm: result.bpmStr, key: result.key ?? ""
                    )
                    await MainActor.run {
                        seratoData = djd
                        rekordboxData = nil
                    }
                    updated.djData = djd
                }
                ValidationService.revalidate(&updated)
                await MainActor.run {
                    state.updateTrack(updated)
                    var parts = ["TBPM", "Serato BeatGrid"]
                    if let r = result.rekordboxUpdated, r { parts.append("rekordbox.xml") }
                    statusMsg = "✓ BPM gravado: \(parts.joined(separator: " + "))"
                }
            } catch {
                await MainActor.run { statusMsg = "Erro ao gravar: \(error.localizedDescription)" }
            }
            await MainActor.run { isWriting = false }
        }
    }

    // MARK: - Write button

    @ViewBuilder
    private var writeButton: some View {
        let data = primaryData ?? seratoData ?? rekordboxData
        if let dj = data {
            Button {
                writeToTags(dj)
            } label: {
                Label(isWriting ? "Gravando…" : "Gravar nas Tags do MP3",
                      systemImage: "square.and.arrow.down.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isWriting)
            .tint(.purple)
        }
    }

    // MARK: - Logic

    private func autoLoad() async {
        if APIKeys.djUseSerato    { await loadSerato() }
        if APIKeys.djUseRekordbox { await loadRekordbox() }
    }

    private func importSerato() {
        Task { await loadSerato() }
    }

    private func importRekordbox() {
        Task { await loadRekordbox() }
    }

    private func loadSerato() async {
        await MainActor.run { isLoadingSerato = true; statusMsg = nil }
        do {
            if let data = try await DJService.shared.readSerato(track: track) {
                await MainActor.run {
                    seratoData = data
                    statusMsg  = "✓ Serato carregado"
                    syncToTrack()
                }
            } else {
                await MainActor.run { statusMsg = "Serato: faixa não encontrada" }
            }
        } catch {
            await MainActor.run { statusMsg = "Serato: \(error.localizedDescription)" }
        }
        await MainActor.run { isLoadingSerato = false }
    }

    private func loadRekordbox() async {
        await MainActor.run { isLoadingRekordbox = true; statusMsg = nil }
        do {
            if let data = try await DJService.shared.readRekordbox(track: track) {
                await MainActor.run {
                    rekordboxData = data
                    statusMsg     = "✓ Rekordbox carregado"
                    syncToTrack()
                }
            } else {
                await MainActor.run { statusMsg = "Rekordbox: faixa não encontrada" }
            }
        } catch {
            await MainActor.run { statusMsg = "Rekordbox: \(error.localizedDescription)" }
        }
        await MainActor.run { isLoadingRekordbox = false }
    }

    private func writeToTags(_ dj: DJData) {
        isWriting = true
        Task {
            do {
                let changed = try await DJService.shared.writeDJTags(to: track, djData: dj)
                await MainActor.run {
                    var written = dj; written.isWrittenToTags = true
                    if dj.source == .serato    { seratoData    = written }
                    if dj.source == .rekordbox { rekordboxData = written }
                    syncToTrack()
                    statusMsg = "✓ \(changed.count) campos gravados nas tags"
                }
            } catch {
                await MainActor.run { statusMsg = "Erro: \(error.localizedDescription)" }
            }
            await MainActor.run { isWriting = false }
        }
    }

    private func applyField(_ fieldId: String, value: String) {
        var updated = track
        switch fieldId {
        case "bpm": updated.bpm = value
        case "key": updated.key = value
        default: break
        }
        state.updateTrack(updated)
    }

    private func syncToTrack() {
        let data = primaryData ?? seratoData ?? rekordboxData
        var updated = track
        updated.djData = data
        if updated.bpm.isEmpty { updated.bpm = data?.bpm ?? "" }
        if updated.key.isEmpty { updated.key = data?.key ?? "" }
        state.updateTrack(updated)
    }

    // MARK: - Consensus builder

    private func buildConsensus() -> DJConsensus? {
        let sources: [(String, DJData?)] = [
            ("Serato", seratoData),
            ("Rekordbox", rekordboxData)
        ]
        let available = sources.filter { $0.1 != nil }
        guard !available.isEmpty else { return nil }

        let primaryName: String = {
            switch primaryPref {
            case .serato:    return "Serato"
            case .rekordbox: return "Rekordbox"
            case .both, .none: return available.first?.0 ?? ""
            }
        }()

        func field(_ id: String, label: String, value: (DJData) -> String) -> DJConsensusField {
            let entries = available.compactMap { (name, data) -> (String, String)? in
                guard let d = data else { return nil }
                let v = value(d)
                return v.isEmpty ? nil : (name, v)
            }
            let primaryVal = available.first(where: { $0.0 == primaryName })?.1.map(value) ?? ""
            let chosen = entries.first(where: { $0.0 == primaryName })?.1 ?? entries.first?.1 ?? ""
            return DJConsensusField(id: id, label: label, entries: entries,
                                    preferredValue: primaryVal ?? "", chosenValue: chosen)
        }

        let fields = [
            field("bpm", label: "BPM") { $0.bpm },
            field("key", label: "Tom") { $0.key },
        ].filter { !$0.entries.isEmpty }

        return DJConsensus(fields: fields, primarySource: primaryName,
                           allSources: available.map { $0.0 })
    }
}

// MARK: - ConsensusRow

struct ConsensusRow: View {
    let field: DJConsensusField
    let primarySource: String
    var onChoose: (String) -> Void

    @State private var forceExpanded = false

    private var isExpanded: Bool { !field.hasConsensus || forceExpanded }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(field.label)
                    .font(.caption2.bold()).foregroundStyle(.secondary)
                    .frame(width: 32, alignment: .leading)

                if field.hasConsensus {
                    Text(field.chosenValue)
                        .font(.callout.bold())
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green).font(.caption)
                    Spacer()
                    Button { forceExpanded.toggle() } label: {
                        Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                } else {
                    ConfidenceBar(confidence: field.confidence)
                    Spacer()
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange).font(.caption)
                }
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(field.entries, id: \.source) { entry in
                        HStack(spacing: 6) {
                            SourceDot(source: entry.source)
                            Text(entry.source)
                                .font(.caption)
                                .fontWeight(entry.source == primarySource ? .bold : .regular)
                                .foregroundStyle(entry.source == primarySource ? .primary : .secondary)
                            Text(entry.value)
                                .font(.caption.bold())
                            if entry.source == primarySource {
                                Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                            }
                            Spacer()
                            if !field.hasConsensus {
                                Button("Usar") { onChoose(entry.value) }
                                    .font(.caption)
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                            }
                        }
                    }
                }
                .padding(.leading, 40)
            }
        }
    }
}

// MARK: - SourcePanel (modo expandido por fonte)

struct SourcePanel: View {
    let data: DJData
    let isPrimary: Bool
    var onSelect: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SourceBadge(source: data.source)
                if isPrimary {
                    Text("PRINCIPAL").font(.caption2.bold()).foregroundStyle(.yellow)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.yellow.opacity(0.2)).cornerRadius(4)
                }
                Spacer()
                if data.isWrittenToTags {
                    Label("Gravado", systemImage: "checkmark.circle.fill")
                        .font(.caption2).foregroundStyle(.green)
                }
            }

            HStack(spacing: 16) {
                if !data.bpm.isEmpty {
                    ClickableMetaChip(label: "BPM", value: data.bpm) { onSelect("bpm", data.bpm) }
                }
                if !data.key.isEmpty {
                    ClickableMetaChip(label: "Tom", value: data.key) { onSelect("key", data.key) }
                }
                if data.rating > 0 {
                    MetaChip(label: "★", value: String(repeating: "★", count: data.rating), icon: nil)
                }
                if !data.color.isEmpty { ColorDot(hex: data.color) }
            }

            if !data.cues.isEmpty {
                ForEach(data.cues.prefix(4)) { CueRow(cue: $0) }
            }
        }
        .padding(10)
        .background(isPrimary ? Color.accentColor.opacity(0.06) : Color.secondary.opacity(0.05))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .stroke(isPrimary ? Color.accentColor.opacity(0.3) : Color.clear, lineWidth: 1))
        .cornerRadius(8)
    }
}

// MARK: - Small helpers

struct ConfidenceBar: View {
    let confidence: Double
    var color: Color { confidence >= 0.9 ? .green : confidence >= 0.6 ? .orange : .red }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.2))
                Capsule().fill(color).frame(width: geo.size.width * confidence)
            }
        }
        .frame(width: 60, height: 6)
    }
}

struct SourceDot: View {
    let source: String
    var color: Color { source == "Serato" ? .teal : source == "Rekordbox" ? .red : .gray }
    var body: some View {
        Circle().fill(color).frame(width: 6, height: 6)
    }
}

struct SourcePill: View {
    let name: String
    let isPrimary: Bool
    var color: Color { name == "Serato" ? .teal : name == "Rekordbox" ? .red : .gray }

    var body: some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text(name).font(.caption2)
            if isPrimary { Image(systemName: "star.fill").font(.system(size: 7)).foregroundStyle(.yellow) }
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(color.opacity(0.1)).cornerRadius(8)
    }
}

struct ClickableMetaChip: View {
    let label: String
    let value: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 1) {
                Text(value).font(.callout.bold())
                Text(label).font(.caption2).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Color.accentColor.opacity(0.08))
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .help("Aplicar \(label): \(value)")
    }
}

// reusar de DJDataView anterior
struct ImportButton: View {
    let label: String; let icon: String; let color: Color
    let isLoading: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isLoading { ProgressView().scaleEffect(0.6).frame(width: 14, height: 14) }
                else { Image(systemName: icon).font(.caption) }
                Text(label).font(.callout)
            }.frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered).tint(color).disabled(isLoading)
    }
}

struct DJImportButton: View {
    let label: String; let icon: String; let color: Color
    let isLoading: Bool; let isPrimary: Bool; let isLoaded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isLoading {
                    ProgressView().scaleEffect(0.6).frame(width: 14, height: 14)
                } else if isLoaded {
                    Image(systemName: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
                } else {
                    Image(systemName: icon).font(.caption)
                }
                Text(label).font(.callout)
                if isPrimary {
                    Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(.yellow)
                }
            }.frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(isLoaded ? .green : color)
        .disabled(isLoading)
    }
}

// Reusar views de CueRow, LoopRow, ColorDot, MetaChip, SourceBadge do arquivo anterior

private func formatMs(_ ms: Int) -> String {
    let total = ms / 1000; let m = total / 60; let s = total % 60; let cs = (ms % 1000) / 10
    return String(format: "%d:%02d.%02d", m, s, cs)
}

// MARK: - Shared DJ subviews

struct SourceBadge: View {
    let source: DJSource
    var color: Color { source == .serato ? .teal : source == .rekordbox ? .red : .purple }
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(source.rawValue).font(.caption.bold()).foregroundStyle(color)
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(color.opacity(0.12)).cornerRadius(10)
    }
}

struct MetaChip: View {
    let label: String; let value: String; let icon: String?
    var body: some View {
        VStack(spacing: 1) {
            if let icon { Image(systemName: icon).font(.caption2).foregroundStyle(.secondary) }
            Text(value).font(.callout.bold())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

struct ColorDot: View {
    let hex: String
    var color: Color {
        guard hex.hasPrefix("#"), hex.count == 7,
              let r = Int(hex.dropFirst(1).prefix(2), radix: 16),
              let g = Int(hex.dropFirst(3).prefix(2), radix: 16),
              let b = Int(hex.dropFirst(5).prefix(2), radix: 16) else { return .clear }
        return Color(red: Double(r)/255, green: Double(g)/255, blue: Double(b)/255)
    }
    var body: some View {
        Circle().fill(color).frame(width: 16, height: 16)
            .overlay(Circle().stroke(Color.secondary.opacity(0.3), lineWidth: 0.5))
    }
}

struct CueRow: View {
    let cue: CuePoint
    var body: some View {
        HStack(spacing: 8) {
            ColorDot(hex: cue.color.isEmpty ? "#CC0000" : cue.color)
            Text("\(cue.index + 1)").font(.caption.bold()).frame(width: 14)
            Text(formatMs(cue.positionMs)).font(.caption).monospacedDigit()
            if !cue.name.isEmpty { Text(cue.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            if cue.isHot {
                Text("HOT").font(.caption2.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(Color.orange).cornerRadius(3)
            }
        }
    }
}

struct LoopRow: View {
    let loop: CueLoop
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "repeat").font(.caption).foregroundStyle(.blue)
            Text(formatMs(loop.inMs)).font(.caption).monospacedDigit()
            Text("→").font(.caption2).foregroundStyle(.secondary)
            Text(formatMs(loop.outMs)).font(.caption).monospacedDigit()
            if !loop.name.isEmpty { Text(loop.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
    }
}

// MARK: - AI BPM Result View

struct AIBPMResultView: View {
    let ai: AIBPMResult
    let seratoBPM: String?
    let rekordboxBPM: String?
    let onWrite: () -> Void

    private var confidenceColor: Color {
        ai.confidence >= 0.85 ? .green : ai.confidence >= 0.65 ? .orange : .red
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                // BPM
                VStack(spacing: 2) {
                    Text(ai.bpmStr)
                        .font(.title2.bold().monospacedDigit())
                        .foregroundStyle(.purple)
                    Text("BPM").font(.caption2).foregroundStyle(.secondary)
                }

                // Tom (Key)
                if let key = ai.key, !key.isEmpty {
                    VStack(spacing: 2) {
                        Text(key)
                            .font(.title2.bold())
                            .foregroundStyle(.indigo)
                        Text("Tom").font(.caption2).foregroundStyle(.secondary)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("Confiança")
                            .font(.caption2).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.secondary.opacity(0.2))
                                Capsule().fill(confidenceColor)
                                    .frame(width: geo.size.width * ai.confidence)
                            }
                        }
                        .frame(height: 6)
                        Text("\(Int(ai.confidence * 100))%")
                            .font(.caption2.bold()).foregroundStyle(confidenceColor)
                    }

                    HStack(spacing: 6) {
                        Text("1º beat").font(.caption2).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
                        Text("\(Int(ai.firstBeatOffsetMs)) ms").font(.caption2.monospacedDigit())
                    }

                    HStack(spacing: 6) {
                        Text("Beats").font(.caption2).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
                        Text("\(ai.beatCount) detectados").font(.caption2)
                    }
                }
            }

            // Comparison with DJ software values
            let comparisons: [(String, String, Color)] = [
                ("Serato",    seratoBPM    ?? "—",  .teal),
                ("Rekordbox", rekordboxBPM ?? "—",  .red),
            ]
            HStack(spacing: 16) {
                ForEach(comparisons, id: \.0) { src, bpm, color in
                    VStack(spacing: 2) {
                        Text(bpm)
                            .font(.caption.bold().monospacedDigit())
                            .foregroundStyle(bpm == "—" ? Color.secondary : closeToBPM(bpm) ? Color.green : Color.orange)
                        Text(src).font(.caption2).foregroundStyle(color)
                    }
                }
                Spacer()
            }

            Button {
                onWrite()
            } label: {
                Label("Gravar BPM + Serato + Rekordbox", systemImage: "square.and.arrow.down.fill")
                    .frame(maxWidth: .infinity)
                    .font(.caption)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.small)
        }
    }

    private func closeToBPM(_ str: String) -> Bool {
        guard let v = Double(str) else { return false }
        return abs(v - ai.bpm) <= 2.0 || abs(v * 2 - ai.bpm) <= 2.0 || abs(v / 2 - ai.bpm) <= 2.0
    }
}
