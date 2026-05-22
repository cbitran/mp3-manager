import SwiftUI

struct SettingsView: View {
    // API keys
    @State private var discogsToken = APIKeys.discogs
    @State private var acoustIDKey  = APIKeys.acoustID
    // DJ prefs
    @State private var djPrimary    = APIKeys.djPrimary
    @State private var djAutoImport = APIKeys.djAutoImport
    @State private var djShowAll    = APIKeys.djShowAll
    @State private var saved = false

    @AppStorage("appColorScheme") private var colorScheme: String = "auto"

    var body: some View {
        TabView {
            appearanceTab.tabItem { Label("Aparência", systemImage: "paintpalette") }
            djTab.tabItem { Label("Software DJ", systemImage: "music.note.list") }
            apiTab.tabItem { Label("APIs Externas", systemImage: "network") }
        }
        .frame(width: 520)
        .padding()
    }

    // MARK: - Appearance Tab

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

    // MARK: - DJ Tab

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

            saveSection
        }
        .formStyle(.grouped)
    }

    // MARK: - API Tab

    private var apiTab: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Discogs Personal Token", systemImage: "key.fill").font(.callout.bold())
                    SecureField("cole seu token aqui", text: $discogsToken).textFieldStyle(.roundedBorder)
                    Text("discogs.com → Configurações → Desenvolvedores → Token pessoal")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } header: { Text("Discogs") }

            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Label("AcoustID Client Key", systemImage: "waveform.badge.magnifyingglass").font(.callout.bold())
                    SecureField("cole sua chave aqui", text: $acoustIDKey).textFieldStyle(.roundedBorder)
                    Text("acoustid.org/login → Registrar aplicativo (gratuito)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } header: { Text("AcoustID") }

            saveSection
        }
        .formStyle(.grouped)
    }

    // MARK: - Save

    private var saveSection: some View {
        Section {
            HStack {
                Spacer()
                if saved {
                    Label("Salvo!", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green).transition(.opacity)
                }
                Button("Salvar Preferências") {
                    APIKeys.save(discogs: discogsToken, acoustID: acoustIDKey)
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
