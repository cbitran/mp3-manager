import SwiftUI

struct SettingsView: View {
    // Aparência
    @AppStorage("appColorScheme") private var colorScheme: String = "auto"

    // Serviços — ligados por padrão (defaults via APIKeys)
    @AppStorage("service.spotify.enabled")     private var useSpotify:     Bool = true
    @AppStorage("service.lastfm.enabled")      private var useLastFM:      Bool = true
    @AppStorage("service.itunes.enabled")      private var useiTunes:      Bool = true
    @AppStorage("service.musicbrainz.enabled") private var useMusicBrainz: Bool = true

    // DJ prefs
    @State private var djPrimary    = APIKeys.djPrimary
    @State private var djAutoImport = APIKeys.djAutoImport
    @State private var djShowAll    = APIKeys.djShowAll
    @State private var savedDJ = false

    // Colunas (mesmo @AppStorage que TrackListView)
    @AppStorage("trackTableColumnCustomization_v3")
    private var columnCustomization: TableColumnCustomization<Track>

    var body: some View {
        TabView {
            appearanceTab .tabItem { Label("Aparência",   systemImage: "paintpalette") }
            servicesTab   .tabItem { Label("Serviços",    systemImage: "network") }
            columnsTab    .tabItem { Label("Colunas",     systemImage: "slider.horizontal.3") }
            djTab         .tabItem { Label("Software DJ", systemImage: "music.note.list") }
        }
        .frame(width: 540)
        .padding()
    }

    // MARK: - Aparência

    private var appearanceTab: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Tema", systemImage: "circle.lefthalf.filled")
                        .font(.callout.bold())
                    Text("Escolha entre o tema claro, escuro ou siga o sistema.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: $colorScheme) {
                        HStack(spacing: 6) {
                            Image(systemName: "circle.lefthalf.filled")
                            Text("Automático")
                        }.tag("auto")
                        HStack(spacing: 6) {
                            Image(systemName: "sun.max.fill")
                            Text("Claro")
                        }.tag("light")
                        HStack(spacing: 6) {
                            Image(systemName: "moon.fill")
                            Text("Escuro")
                        }.tag("dark")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
            } header: { Text("Tema") }
        }
        .formStyle(.grouped)
    }

    // MARK: - Serviços

    private var servicesTab: some View {
        Form {
            Section {
                Text("Escolha quais serviços externos são usados para enriquecer seus metadados. Nenhuma configuração é necessária — tudo já está pronto para uso.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                serviceRow(
                    icon: "waveform.circle.fill",
                    color: .green,
                    name: "Spotify",
                    description: "BPM, Tom Musical, Álbum e Ano de lançamento",
                    isOn: $useSpotify
                )
                serviceRow(
                    icon: "music.note",
                    color: .red,
                    name: "Last.fm",
                    description: "Gênero musical baseado em popularidade",
                    isOn: $useLastFM
                )
                serviceRow(
                    icon: "applelogo",
                    color: .primary,
                    name: "Apple Music / iTunes",
                    description: "Gênero, Álbum, Ano e Capa do álbum",
                    isOn: $useiTunes
                )
                serviceRow(
                    icon: "magnifyingglass.circle.fill",
                    color: .orange,
                    name: "MusicBrainz",
                    description: "Validação de metadados com base de dados aberta",
                    isOn: $useMusicBrainz
                )
            } header: { Text("Serviços de Enriquecimento") }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private func serviceRow(icon: String, color: Color, name: String,
                             description: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(isOn.wrappedValue ? color : .secondary)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.callout.weight(.medium))
                    Text(description).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Colunas

    private let allColumns: [(id: String, label: String, icon: String)] = [
        ("status",      "Status",          "circle.fill"),
        ("favorite",    "Favorita",        "star.fill"),
        ("cover",       "Capa",            "photo"),
        ("tracknumber", "Faixa #",         "number"),
        ("title",       "Título",          "music.note"),
        ("artist",      "Artista",         "person"),
        ("album",       "Álbum",           "square.stack"),
        ("year",        "Ano",             "calendar"),
        ("bpm",         "BPM",             "metronome"),
        ("key",         "Tom",             "pianokeys"),
        ("waveform",    "Forma de Onda",   "waveform"),
        ("rating",      "Avaliação",       "star"),
        ("genre",       "Gênero",          "tag"),
        ("duration",    "Duração",         "clock"),
        ("filesize",    "Tamanho",         "internaldrive"),
        ("filetype",    "Tipo",            "doc"),
        ("dateadded",   "Adicionada",      "calendar.badge.plus"),
        ("comment",     "Comentário",      "text.bubble"),
    ]

    private var columnsTab: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Escolha quais colunas aparecem na lista de faixas.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Button("Restaurar padrão") {
                    columnCustomization = TableColumnCustomization<Track>()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.bottom, 12)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                ForEach(allColumns, id: \.id) { col in
                    let isVisible = columnCustomization[visibility: col.id] != .hidden
                    Button {
                        columnCustomization[visibility: col.id] = isVisible ? .hidden : .visible
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: col.icon)
                                .frame(width: 18)
                                .foregroundStyle(isVisible ? Color.accentColor : .secondary)
                            Text(col.label)
                                .font(.callout)
                                .foregroundStyle(isVisible ? .primary : .secondary)
                            Spacer()
                            Image(systemName: isVisible ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(isVisible ? Color.accentColor : Color.secondary.opacity(0.4))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(isVisible
                                      ? Color.accentColor.opacity(0.08)
                                      : Color.secondary.opacity(0.05))
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 16)
        }
        .padding(.horizontal, 4)
        .padding(.top, 12)
    }

    // MARK: - Software DJ

    private var djTab: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Software principal", systemImage: "star.fill")
                        .font(.callout.bold())
                    Text("Define qual software carrega automaticamente ao selecionar uma faixa.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: $djPrimary) {
                        ForEach(DJSoftwarePreference.allCases) { pref in
                            Label(pref.rawValue, systemImage: pref.icon).tag(pref)
                        }
                    }
                    .pickerStyle(.radioGroup)
                }
            } header: { Text("Software DJ") }

            Section {
                Toggle("Auto-importar dados DJ ao selecionar faixa", isOn: $djAutoImport)
                    .help("Carrega BPM, Key e Cue Points automaticamente quando você clica em uma música")
                Toggle("Mostrar análises de todas as fontes no Inspector", isOn: $djShowAll)
                    .help("Exibe valores de Serato E Rekordbox lado a lado")
            } header: { Text("Comportamento") }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Como funciona o Consenso", systemImage: "chart.bar.fill")
                        .font(.callout.bold())
                    ConsensusExplainer()
                }
            } header: { Text("Visualização") }

            Section {
                HStack {
                    Spacer()
                    if savedDJ {
                        Label("Salvo!", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green).transition(.opacity)
                    }
                    Button("Salvar Preferências") {
                        APIKeys.saveDJPrefs(primary: djPrimary, autoImport: djAutoImport, showAll: djShowAll)
                        withAnimation { savedDJ = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation { savedDJ = false }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .formStyle(.grouped)
    }
}

struct ConsensusExplainer: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Todas as fontes concordam → exibe só o valor").font(.caption)
            }
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("Fontes divergem → expande para você escolher").font(.caption)
            }
            HStack(spacing: 8) {
                Image(systemName: "star.fill").foregroundStyle(.yellow)
                Text("Fonte principal sempre destacada em negrito").font(.caption)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.07))
        .cornerRadius(8)
    }
}
