import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { toast } from "./Toast";

interface DjDatabasePaths {
  rekordbox: string | null;
  serato: string | null;
  rekordbox_running: boolean;
  serato_running: boolean;
}

interface RbCue {
  position_ms: number;
  kind: number;
  hot_cue_number: number;
  color_r: number;
  color_g: number;
  color_b: number;
  comment: string;
}

interface RbTrack {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  cues: RbCue[];
}

interface RbPlaylist {
  id: number;
  name: string;
  is_folder: boolean;
  track_ids: number[];
}

interface RbLibrary {
  db_path: string;
  tracks: RbTrack[];
  playlists: RbPlaylist[];
  total_tracks: number;
  total_cues: number;
}

interface SeratoCrate {
  name: string;
  path: string;
  track_paths: string[];
}

interface DjSyncStats {
  tracks_read: number;
  tracks_matched: number;
  cues_imported: number;
  cues_exported: number;
  playlists_synced: number;
}

interface Props { onClose: () => void; }

type Tab = "rekordbox" | "serato";
type RbAction = "idle" | "reading" | "importing_cues" | "exporting_cues" | "exporting_playlists";

export default function DjSyncModal({ onClose }: Props) {
  const tracks = useAppStore((s) => s.tracks);

  const [tab, setTab] = useState<Tab>("rekordbox");
  const [paths, setPaths] = useState<DjDatabasePaths | null>(null);
  const [rbLib, setRbLib] = useState<RbLibrary | null>(null);
  const [seratoCrates, setSeratoCrates] = useState<SeratoCrate[] | null>(null);
  const [rbAction, setRbAction] = useState<RbAction>("idle");
  const [lastStats, setLastStats] = useState<DjSyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<DjDatabasePaths>("detect_dj_databases").then(setPaths).catch(() => {});
  }, []);

  // ── Rekordbox ────────────────────────────────────────────────────────────

  async function readRekordbox() {
    setRbAction("reading");
    setError(null);
    try {
      const lib = await invoke<RbLibrary>("read_rekordbox_library", { dbPath: paths?.rekordbox ?? null });
      setRbLib(lib);
    } catch (e) {
      setError(String(e));
    }
    setRbAction("idle");
  }

  async function importCuesFromRekordbox() {
    if (!rbLib) return;
    setRbAction("importing_cues");
    setError(null);
    try {
      // Passa todos os caminhos do TagWave para match; também importa playlists do RB
      const twPaths = tracks.map((t) => t.path);
      const stats = await invoke<DjSyncStats>("import_cues_from_rekordbox", {
        dbPath: paths?.rekordbox ?? null,
        tagwaveTrackPaths: twPaths,
      });

      // Importar playlists do Rekordbox automaticamente junto com os cues
      const { createPlaylist, playlists: existing } = useAppStore.getState();
      let plImported = 0;
      for (const pl of rbLib.playlists.filter((p) => !p.is_folder && p.track_ids.length > 0)) {
        if (existing.some((e) => e.name.toLowerCase() === pl.name.toLowerCase())) continue;
        // Mapear track_ids → caminhos reais do master.db
        const plPaths = pl.track_ids
          .map((id) => rbLib.tracks.find((t) => t.id === id)?.path)
          .filter(Boolean) as string[];
        if (plPaths.length > 0) { createPlaylist(pl.name, plPaths); plImported++; }
      }

      setLastStats({ ...stats, playlists_synced: plImported });
      const msg = [
        stats.cues_imported > 0 ? `${stats.cues_imported} cues importados` : "",
        plImported > 0 ? `${plImported} playlists criadas` : "",
        stats.tracks_matched === 0 ? "Nenhuma faixa em comum — escaneie as pastas primeiro" : "",
      ].filter(Boolean).join(" · ");
      toast(msg || "Importação concluída", stats.cues_imported > 0 ? "success" : "info");
    } catch (e) {
      setError(String(e));
    }
    setRbAction("idle");
  }

  async function exportCuesToRekordbox() {
    setRbAction("exporting_cues");
    setError(null);
    try {
      const tracksWithCues = tracks
        .filter((t) => t.cue_points && t.cue_points.length > 0)
        .map((t) => ({ path: t.path, cues: t.cue_points }));

      if (tracksWithCues.length === 0) {
        toast("Nenhuma faixa com cues para exportar", "info");
        setRbAction("idle");
        return;
      }

      const stats = await invoke<DjSyncStats>("export_cues_to_rekordbox", {
        dbPath: paths?.rekordbox ?? null,
        tracksWithCues,
      });
      setLastStats(stats);
      toast(`${stats.cues_exported} cues exportados para o Rekordbox`, "success");
    } catch (e) {
      setError(String(e));
    }
    setRbAction("idle");
  }

  async function exportPlaylistsToRekordbox() {
    setRbAction("exporting_playlists");
    setError(null);
    try {
      const playlists = useAppStore.getState().playlists
        .filter((pl) => pl.trackPaths.length > 0)
        .map((pl) => ({ name: pl.name, track_paths: pl.trackPaths }));

      if (playlists.length === 0) {
        toast("Nenhuma playlist para exportar", "info");
        setRbAction("idle");
        return;
      }

      const stats = await invoke<DjSyncStats>("export_playlists_to_rekordbox", {
        dbPath: paths?.rekordbox ?? null,
        playlists,
      });
      setLastStats(stats);
      toast(`${stats.playlists_synced} playlists exportadas para o Rekordbox`, "success");
    } catch (e) {
      setError(String(e));
    }
    setRbAction("idle");
  }

  async function restoreBackup() {
    try {
      await invoke("restore_rekordbox_backup", { dbPath: paths?.rekordbox ?? null });
      toast("Backup do Rekordbox restaurado", "success");
      setRbLib(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // ── Serato ───────────────────────────────────────────────────────────────

  async function readSerato() {
    setError(null);
    try {
      const crates = await invoke<SeratoCrate[]>("read_serato_crates");
      setSeratoCrates(crates);
    } catch (e) {
      setError(String(e));
    }
  }

  async function importSeratoCratesAsPlaylists() {
    if (!seratoCrates) return;
    setError(null);
    const { createPlaylist, playlists: existing } = useAppStore.getState();
    let imported = 0;

    for (const crate of seratoCrates) {
      if (crate.track_paths.length === 0) continue;
      // Importa mesmo que as faixas não estejam carregadas — os caminhos ficam
      // salvos na playlist e serão resolvidos quando o usuário escanear as pastas
      const alreadyExists = existing.some(
        (p) => p.name.toLowerCase() === crate.name.toLowerCase()
      );
      if (alreadyExists) continue;

      createPlaylist(crate.name, crate.track_paths);
      imported++;
    }

    toast(`${imported} crates importados como playlists`, "success");
    setLastStats({ tracks_read: seratoCrates.length, tracks_matched: imported, cues_imported: 0, cues_exported: 0, playlists_synced: imported });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const busy = rbAction !== "idle";
  const twTracksWithCues = tracks.filter((t) => t.cue_points && t.cue_points.length > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 520, maxHeight: "88vh", background: "var(--bg-elevated, #1c1715)", border: "1px solid rgba(255,255,255,0.08)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D95340" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>DJ Sync</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(217,83,64,0.15)", color: "#D95340" }}>BETA</span>
          </div>
          <button onClick={onClose} className="text-[#605A55] hover:text-[#C2BEBC] transition-colors p-1">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          {(["rekordbox", "serato"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-[12px] font-semibold transition-colors capitalize ${
                tab === t ? "text-[#D95340] border-b-2 border-[#D95340]" : "text-[#605A55] hover:text-[#8F8883]"
              }`}>
              {t === "rekordbox" ? "Rekordbox" : "Serato DJ"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Status da base de dados */}
          {paths && (
            <div className="flex flex-col gap-1.5">
              {tab === "rekordbox" && (
                <StatusRow
                  label="master.db"
                  value={paths.rekordbox ? "Encontrado" : "Não encontrado"}
                  detail={paths.rekordbox ?? undefined}
                  ok={!!paths.rekordbox}
                  warn={paths.rekordbox_running ? "Rekordbox está aberto — feche antes de exportar" : undefined}
                />
              )}
              {tab === "serato" && (
                <StatusRow
                  label="_Serato_"
                  value={paths.serato ? "Encontrado" : "Não encontrado"}
                  detail={paths.serato ?? undefined}
                  ok={!!paths.serato}
                />
              )}
            </div>
          )}

          {error && (
            <div className="px-3 py-2.5 rounded-lg text-[11px]" style={{ background: "rgba(217,83,64,0.12)", border: "1px solid rgba(217,83,64,0.3)", color: "#E07364" }}>
              {error}
            </div>
          )}

          {/* ── REKORDBOX ── */}
          {tab === "rekordbox" && (
            <>
              {/* Ler biblioteca */}
              <section>
                <SectionTitle>1. Ler biblioteca do Rekordbox</SectionTitle>
                <p className="text-[11px] text-[#605A55] mb-3">
                  Lê tracks, hot cues e playlists diretamente do master.db (descriptografado internamente).
                </p>
                <ActionButton
                  onClick={readRekordbox}
                  disabled={!paths?.rekordbox || busy}
                  loading={rbAction === "reading"}
                >
                  {rbAction === "reading" ? "Lendo banco…" : "Ler Rekordbox"}
                </ActionButton>
                {rbLib && (
                  <StatsRow items={[
                    { label: "Faixas", value: rbLib.total_tracks },
                    { label: "Hot cues", value: rbLib.total_cues },
                    { label: "Playlists", value: rbLib.playlists.filter((p) => !p.is_folder).length },
                  ]} />
                )}
              </section>

              {/* Importar cues para TagWave */}
              <section>
                <SectionTitle>2. Importar hot cues → TagWave + Serato</SectionTitle>
                <p className="text-[11px] text-[#605A55] mb-3">
                  Para cada faixa em comum, copia os hot cues do Rekordbox para o arquivo de áudio
                  (formato Serato Markers2). Serato e TagWave passam a ver os mesmos cues.
                </p>
                <ActionButton
                  onClick={importCuesFromRekordbox}
                  disabled={!rbLib || busy}
                  loading={rbAction === "importing_cues"}
                >
                  {rbAction === "importing_cues" ? "Importando…" : `Importar cues do Rekordbox (${rbLib?.total_cues ?? 0})`}
                </ActionButton>
              </section>

              {/* Exportar cues para Rekordbox */}
              <section>
                <SectionTitle>3. Exportar hot cues TagWave → Rekordbox</SectionTitle>
                <p className="text-[11px] text-[#605A55] mb-3">
                  Escreve os cues do TagWave diretamente no master.db. Rekordbox deve estar fechado.
                </p>
                {paths?.rekordbox_running && (
                  <div className="text-[11px] text-[#D95340] mb-2 flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="#D95340"><path d="M5 1L9 9H1L5 1Z"/></svg>
                    Feche o Rekordbox para habilitar esta ação
                  </div>
                )}
                <ActionButton
                  onClick={exportCuesToRekordbox}
                  disabled={!paths?.rekordbox || paths.rekordbox_running || busy || twTracksWithCues === 0}
                  loading={rbAction === "exporting_cues"}
                  accent
                >
                  {rbAction === "exporting_cues" ? "Exportando…" : `Exportar cues → Rekordbox (${twTracksWithCues} faixas)`}
                </ActionButton>
              </section>

              {/* Exportar playlists */}
              <section>
                <SectionTitle>4. Exportar playlists TagWave → Rekordbox</SectionTitle>
                <ActionButton
                  onClick={exportPlaylistsToRekordbox}
                  disabled={!paths?.rekordbox || paths.rekordbox_running || busy}
                  loading={rbAction === "exporting_playlists"}
                  accent
                >
                  {rbAction === "exporting_playlists" ? "Exportando…" : `Exportar ${useAppStore.getState().playlists.length} playlists → Rekordbox`}
                </ActionButton>
              </section>

              {/* Restaurar backup */}
              <section className="border-t border-white/[0.06] pt-3">
                <SectionTitle>Restaurar backup</SectionTitle>
                <p className="text-[11px] text-[#605A55] mb-2">
                  O TagWave cria um backup automático antes de cada escrita. Restaura o master.db ao estado anterior.
                </p>
                <button
                  onClick={restoreBackup}
                  className="text-[11px] px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: "#8F8883", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Restaurar último backup
                </button>
              </section>
            </>
          )}

          {/* ── SERATO ── */}
          {tab === "serato" && (
            <>
              <section>
                <SectionTitle>1. Ler crates do Serato</SectionTitle>
                <p className="text-[11px] text-[#605A55] mb-3">
                  Lê os arquivos .crate da pasta _Serato_/Subcrates para ver suas playlists.
                </p>
                <ActionButton onClick={readSerato} disabled={!paths?.serato}>
                  Ler crates
                </ActionButton>
                {seratoCrates !== null && (
                  <StatsRow items={[
                    { label: "Crates", value: seratoCrates.length },
                    { label: "Faixas total", value: seratoCrates.reduce((s, c) => s + c.track_paths.length, 0) },
                  ]} />
                )}
              </section>

              {seratoCrates && seratoCrates.length > 0 && (
                <section>
                  <SectionTitle>Crates encontrados</SectionTitle>
                  <div className="flex flex-col gap-1 mb-3 max-h-40 overflow-y-auto">
                    {seratoCrates.map((c) => (
                      <div key={c.path} className="flex items-center justify-between px-3 py-1.5 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <span className="text-[12px]" style={{ color: "var(--text-primary)" }}>{c.name}</span>
                        <span className="text-[10px] text-[#605A55]">{c.track_paths.length} faixas</span>
                      </div>
                    ))}
                  </div>
                  <ActionButton onClick={importSeratoCratesAsPlaylists} accent>
                    Importar como playlists no TagWave
                  </ActionButton>
                </section>
              )}

              <section>
                <SectionTitle>Hot cues Serato ↔ TagWave</SectionTitle>
                <p className="text-[11px] text-[#605A55]">
                  Os hot cues já são sincronizados automaticamente via arquivo de áudio
                  (Serato Markers2). Qualquer cue salvo no TagWave é lido pelo Serato na próxima abertura da faixa.
                </p>
                <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg"
                  style={{ background: "rgba(91,160,85,0.10)", border: "1px solid rgba(91,160,85,0.2)" }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#5BA055" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 5 4 7 8 3"/>
                  </svg>
                  <span className="text-[11px]" style={{ color: "#6DBF7E" }}>Sincronização automática ativa</span>
                </div>
              </section>
            </>
          )}

          {/* Stats da última operação */}
          {lastStats && (
            <div className="border-t border-white/[0.06] pt-3 text-[10px] text-[#605A55] flex gap-4">
              <span>Última operação:</span>
              {lastStats.cues_imported > 0 && <span>{lastStats.cues_imported} cues importados</span>}
              {lastStats.cues_exported > 0 && <span>{lastStats.cues_exported} cues exportados</span>}
              {lastStats.playlists_synced > 0 && <span>{lastStats.playlists_synced} playlists</span>}
              <span>{lastStats.tracks_matched} faixas correspondidas</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">{children}</p>;
}

function StatusRow({ label, value, detail, ok, warn }: { label: string; value: string; detail?: string; ok: boolean; warn?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-[#5BA055]" : "bg-[#D95340]"}`}/>
        <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
        <span className="text-[11px] text-[#605A55] ml-1">{value}</span>
        {detail && <span className="text-[10px] text-[#4C4743] ml-auto truncate max-w-[200px]" title={detail}>{detail.split("/").pop()}</span>}
      </div>
      {warn && (
        <p className="text-[10px] text-[#D95340] mt-1 pl-1 flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="#D95340"><path d="M4 0.5L7.5 7H0.5L4 0.5Z"/></svg>
          {warn}
        </p>
      )}
    </div>
  );
}

function ActionButton({ children, onClick, disabled, loading, accent }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full py-2 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
      style={{
        background: accent ? "#D95340" : "rgba(217,83,64,0.12)",
        color: accent ? "white" : "#D95340",
        border: accent ? "none" : "1px solid rgba(217,83,64,0.25)",
      }}
    >
      {loading && <span className="animate-spin text-sm">⟳</span>}
      {children}
    </button>
  );
}

function StatsRow({ items }: { items: { label: string; value: number }[] }) {
  return (
    <div className="flex gap-4 mt-2 px-1">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <span className="text-[16px] font-bold text-[#D95340]">{item.value.toLocaleString()}</span>
          <span className="text-[9px] text-[#605A55] uppercase tracking-wider">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
