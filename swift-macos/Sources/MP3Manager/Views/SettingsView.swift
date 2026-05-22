import SwiftUI

struct SettingsView: View {
    // Aparência
    @AppStorage("appColorScheme") private var colorScheme: String = "auto"

    // APIs
    @State private var discogsToken       = APIKeys.discogs
    @State private var acoustIDKey        = APIKeys.acoustID
    @State private var spotifyClientId    = APIKeys.spotifyClientId
    @State private var spotifyClientSec   = APIKeys.spotifyClientSecret
    @State private var lastFMKey          = APIKeys.lastFMApiKey

    // DJ prefs
    @State private var djPrimary    = APIKeys.djPrimary
    @State private var djAutoImport = APIKeys.djAutoImport
    @State private var djShowAll    = APIKeys.djShowAll

    @State private var saved = false

    // Colunas (mesmo @AppStorage que TrackListView)
    @AppStorage("trackTableColumnCustomization_v3")
    private var columnCustomization: TableColumnCustomization<Track>

    var body: some View {
        TabView {
            appearanceTab.tabItem { Label("Aparência",  systemImage: "paintpalette") }
            servicesTab.tabItem   { Label("Serviços",   systemImage: "network") }
            columnsTab.tabItem    { Label("Colunas",    systemImage: "slider.horizontal.3") }
            djTab.tabItem         { Label("Software DJ", systemImage: "music.note.list") }
        }
        .frame(width: 540)
        .padding()
    }

    // MARK: - Appearance

    private var appearanceTab: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Tema", systemImage: "circle.lefthalf.filled")
                        .font(.callout.bold())
                    Text("Escolha entre o tema claro, escuro ou siga o sistema operacional.")
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

    // MARK: - Services

    private var servicesTab: some View {
        ScrollView {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Spotify", systemImage: "music.note.list")
                            .font(.callout.bold())
                        Text("Usado para BPM, Tom, Álbum e Ano. Crie um app em developer.spotify.com → Dashboard.")
                            .font(.caption).foregroundStyle(.secondary)

                        credentialField(label: "Client ID", text: $spotifyClientId,
                                        placeholder: "cole o Client ID aqui")
                        credentialField(label: "Client Secret", text: $spotifyClientSec,
                                        placeholder: "cole o Client Secret aqui", secure: true)
                    }
                } header: { Text("Spotify") }

                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Last.fm", systemImage: "waveform")
                            .font(.callout.bold())
                        Text("Usado para gênero e popularidade. Chave gratuita em last.fm/api/account/create.")
                            .font(.caption).foregroundStyle(.secondary)

                        credentialField(label: "API Key", text: $lastFMKey,
                                        placeholder: "cole sua API Key aqui")
                    }
                } header: { Text("Last.fm") }

                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Discogs Personal Token", systemImage: "key.fill")
                            .font(.callout.bold())
                        Text("discogs.com → Configurações → Desenvolvedores → Token pessoal")
                            .font(.caption).foregroundStyle(.secondary)
                        credentialField(label: "Token", text: $discogsToken,
                                        placeholder: "cole seu token aqui", secure: true)
                    }
                } header: { Text("Discogs") }

                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("AcoustID Client Key", systemImage: "waveform.badge.magnifyingglass")
                            .font(.callout.bold())
                        Text("acoustid.org/login → Registrar aplicativo (gratuito)")
                            .font(.caption).foregroundStyle(.secondary)
                        credentialField(label: "Client Key", text: $acoustIDKey,
                                        placeholder: "cole sua chave aqui", secure: true)
                    }
                } header: { Text("AcoustID") }

                Section {
                    HStack {
                        Spacer()
                        if saved {
                            Label("Salvo!", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green).transition(.opacity)
                        }
                        Button("Salvar Credenciais") { saveCredentials() }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .formStyle(.grouped)
        }
    }

    @ViewBuilder
    private func credentialField(label: String, text: Binding<String>,
                                  placeholder: String, secure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            if secure {
                SecureField(placeholder, text: text).textFieldStyle(.roundedBorder)
            } else {
                TextField(placeholder, text: text).textFieldStyle(.roundedBorder)
            }
        }
    }

    // MARK: - Columns

    private let allColumns: [(id: String, label: String, icon: String)] = [
        ("status",      "Status",        "circle.fill"),
        ("favorite",    "Favorita",      "star.fill"),
        ("cover",       "Capa",          "photo"),
        ("tracknumber", "Faixa #",       "number"),
        ("title",       "Título",        "music.note"),
        ("artist",      "Artista",       "person"),
        ("album",       "Álbum",         "square.stack"),
        ("year",        "Ano",           "calendar"),
        ("bpm",         "BPM",           "metronome"),
        ("key",         "Tom",           "pianokeys"),
        ("waveform",    "Forma de Onda", "waveform"),
        ("rating",      "Avaliação",     "star"),
        ("genre",       "Gênero",        "tag"),
        ("duration",    "Duração",       "clock"),
        ("filesize",    "Tamanho",       "internaldrive"),
        ("filetype",    "Tipo",          "doc"),
        ("dateadded",   "Adicionada",    "calendar.badge.plus"),
        ("comment",     "Comentário",    "text.bubble"),
    ]

    private var columnsTab: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Escolha quais colunas aparecem na lista de faixas.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
                                .fill(isVisible ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.05))
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

    // MARK: - DJ

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
                    .help("Exibe valores de Serato E Rekordbox lado a lado, com indicador de consenso")
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
                    if saved {
                        Label("Salvo!", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green).transition(.opacity)
                    }
                    Button("Salvar Preferências") {
                        APIKeys.saveDJPrefs(primary: djPrimary, autoImport: djAutoImport, showAll: djShowAll)
                        withAnimation { saved = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation { saved = false }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .formStyle(.grouped)
    }

    // MARK: - Save

    private func saveCredentials() {
        APIKeys.save(discogs: discogsToken, acoustID: acoustIDKey)
        APIKeys.saveSpotify(clientId: spotifyClientId, clientSecret: spotifyClientSec)
        APIKeys.saveLastFM(apiKey: lastFMKey)
        withAnimation { saved = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation { saved = false }
        }
    }
}

struct ConsensusExplainer: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Todas as fontes concordam → exibe só o valor")
                    .font(.caption)
            }
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("Fontes divergem → expande para você escolher")
                    .font(.caption)
            }
            HStack(spacing: 8) {
                Image(systemName: "star.fill").foregroundStyle(.yellow)
                Text("Fonte principal sempre destacada em negrito")
                    .font(.caption)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.07))
        .cornerRadius(8)
    }
}
