use base64::Engine;
use urlencoding;
use id3::frame::{Comment as Id3Comment, Picture, PictureType};
use id3::TagLike;
use lofty::picture::{MimeType as LoftyMime, Picture as LoftyPic, PictureType as LoftyPicType};
use lofty::config::ParseOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey as LoftyKey, ItemValue as LoftyVal, TagItem as LoftyItem};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

static SCAN_GEN: AtomicUsize = AtomicUsize::new(0);

// ── Tag cache SQLite ──────────────────────────────────────────────────────────

static TAG_CACHE_DB: OnceLock<Mutex<rusqlite::Connection>> = OnceLock::new();

fn tag_cache_db() -> &'static Mutex<rusqlite::Connection> {
    TAG_CACHE_DB.get_or_init(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let dir = std::path::PathBuf::from(&home).join(".tagwave");
        std::fs::create_dir_all(&dir).ok();
        let conn = rusqlite::Connection::open(dir.join("tag_cache.db"))
            .expect("cannot open tag cache db");
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS tag_cache (
                 path  TEXT PRIMARY KEY,
                 mtime INTEGER NOT NULL,
                 data  TEXT NOT NULL
             );"
        ).expect("cannot init tag cache");
        Mutex::new(conn)
    })
}

fn file_mtime(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Lê em lote as entradas do cache.
/// 1. Lê mtimes em paralelo (Rayon, sem lock)
/// 2. Uma única query SQL com IN (...)
/// 3. Verifica mtime e deserializa em paralelo (sem lock)
fn read_cache_batch(paths: &[std::path::PathBuf]) -> HashMap<String, Track> {
    if paths.is_empty() { return HashMap::new(); }

    // Passo 1: mtimes em paralelo, fora do lock
    let path_mtimes: Vec<(String, u64)> = paths.par_iter()
        .map(|p| (p.to_string_lossy().to_string(), file_mtime(p)))
        .collect();

    // Passo 2: uma query batch — lock mínimo
    let rows: Vec<(String, i64, String)> = {
        let Ok(db) = tag_cache_db().lock() else { return HashMap::new(); };
        let placeholders: String = std::iter::repeat("?")
            .take(path_mtimes.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT path, mtime, data FROM tag_cache WHERE path IN ({})",
            placeholders
        );
        let Ok(mut stmt) = db.prepare(&sql) else { return HashMap::new(); };
        let path_strings: Vec<String> = path_mtimes.iter().map(|(p, _)| p.clone()).collect();
        stmt.query_map(rusqlite::params_from_iter(path_strings.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }; // lock liberado aqui

    // Passo 3: verificar mtime e deserializar em paralelo
    let mtime_map: HashMap<String, u64> = path_mtimes.into_iter().collect();
    rows.into_par_iter()
        .filter_map(|(path, stored_mtime, data)| {
            let actual_mtime = *mtime_map.get(&path)?;
            if stored_mtime as u64 != actual_mtime { return None; }
            let track = serde_json::from_str::<Track>(&data).ok()?;
            Some((path, track))
        })
        .collect()
}

/// Grava em lote novas entradas no cache dentro de uma única transação.
fn write_cache_batch(entries: Vec<(String, u64, String)>) {
    if entries.is_empty() { return; }
    let Ok(db) = tag_cache_db().lock() else { return; };
    let Ok(tx) = db.unchecked_transaction() else { return; };
    for (path, mtime, data) in entries {
        let _ = tx.execute(
            "INSERT OR REPLACE INTO tag_cache (path, mtime, data) VALUES (?1, ?2, ?3)",
            rusqlite::params![path, mtime as i64, data],
        );
    }
    let _ = tx.commit();
}
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

macro_rules! dlog {
    ($($arg:tt)*) => { if cfg!(debug_assertions) { eprintln!($($arg)*); } };
}

// ── CUE Points ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CuePoint {
    pub index: u8,
    pub position_ms: u32,
    pub label: String,
    pub color: String,  // "#RRGGBB"
}

fn parse_serato_cue_points(id3tag: &id3::Tag) -> Vec<CuePoint> {
    let frame = id3tag.frames().find(|f| {
        if f.id() != "GEOB" { return false; }
        if let id3::Content::EncapsulatedObject(obj) = f.content() {
            obj.description == "Serato Markers2"
        } else { false }
    });

    let data = match frame.and_then(|f| {
        if let id3::Content::EncapsulatedObject(obj) = f.content() { Some(&obj.data) } else { None }
    }) {
        Some(d) => d,
        None => return Vec::new(),
    };

    let b64_str = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let b64_clean: String = b64_str.chars().filter(|c| !c.is_whitespace()).collect();
    let decoded = match base64::engine::general_purpose::STANDARD.decode(&b64_clean) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };

    if decoded.len() < 2 { return Vec::new(); }
    let mut pos = 2usize; // skip 2-byte version
    let mut cues = Vec::new();

    while pos + 8 <= decoded.len() {
        let tag_type = &decoded[pos..pos + 4];
        pos += 4;
        let len = u32::from_be_bytes([decoded[pos], decoded[pos+1], decoded[pos+2], decoded[pos+3]]) as usize;
        pos += 4;
        if pos + len > decoded.len() { break; }
        let entry = &decoded[pos..pos + len];
        pos += len;

        if tag_type.starts_with(b"CUE") && entry.len() >= 11 {
            let index      = entry[0];
            let pos_ms     = u32::from_be_bytes([entry[1], entry[2], entry[3], entry[4]]);
            let r = entry[6]; let g = entry[7]; let b = entry[8];
            let label = if entry.len() > 11 {
                let end = entry[11..].iter().position(|&b| b == 0).unwrap_or(entry.len() - 11);
                String::from_utf8_lossy(&entry[11..11 + end]).to_string()
            } else { String::new() };
            cues.push(CuePoint { index, position_ms: pos_ms, label, color: format!("#{:02X}{:02X}{:02X}", r, g, b) });
        }
    }
    cues.sort_by_key(|c| c.position_ms);
    cues
}

fn build_serato_markers2(cues: &[CuePoint]) -> Vec<u8> {
    let mut payload: Vec<u8> = vec![0x01, 0x01]; // version
    for cue in cues {
        let r = u8::from_str_radix(&cue.color.get(1..3).unwrap_or("CC"), 16).unwrap_or(0xCC);
        let g = u8::from_str_radix(&cue.color.get(3..5).unwrap_or("00"), 16).unwrap_or(0x00);
        let b_val = u8::from_str_radix(&cue.color.get(5..7).unwrap_or("00"), 16).unwrap_or(0x00);
        let label_bytes = cue.label.as_bytes();
        let entry_len = 11 + label_bytes.len() + 1; // 11 fixed + label + null
        payload.extend_from_slice(b"CUE\0");
        payload.extend_from_slice(&(entry_len as u32).to_be_bytes());
        payload.push(cue.index);
        payload.extend_from_slice(&cue.position_ms.to_be_bytes());
        payload.push(0x00);
        payload.push(r); payload.push(g); payload.push(b_val);
        payload.push(0x00); payload.push(0x00);
        payload.extend_from_slice(label_bytes);
        payload.push(0x00); // null terminator
    }
    payload
}

// ── CUE sidecar helpers (para formatos sem suporte a ID3) ───────────────────

fn cue_sidecar_path(path: &Path) -> std::path::PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let hash = format!("{:x}", hasher.finalize())[..24].to_string();
    let home = home_dir().map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    std::path::PathBuf::from(home).join(".tagwave").join("cues").join(format!("{}.json", hash))
}

fn load_cue_sidecar(path: &Path) -> Vec<CuePoint> {
    let sp = cue_sidecar_path(path);
    fs::read(&sp).ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_cue_sidecar(path: &Path, cues: &[CuePoint]) -> Result<(), String> {
    let sp = cue_sidecar_path(path);
    if let Some(parent) = sp.parent() { fs::create_dir_all(parent).ok(); }
    let json = serde_json::to_vec(cues).map_err(|e| e.to_string())?;
    fs::write(&sp, json).map_err(|e| e.to_string())
}

fn is_id3_format(ext: &str) -> bool {
    matches!(ext, "mp3" | "aif" | "aiff")
}

#[tauri::command]
fn get_cue_points(path: String) -> Vec<CuePoint> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if is_id3_format(&ext) {
        match id3::Tag::read_from_path(p) {
            Ok(tag) => {
                let serato = parse_serato_cue_points(&tag);
                if !serato.is_empty() { return serato; }
                // fallback: sidecar (caso tenha sido salvo antes como sidecar)
                load_cue_sidecar(p)
            }
            Err(_) => load_cue_sidecar(p),
        }
    } else {
        load_cue_sidecar(p)
    }
}

#[tauri::command]
fn save_cue_points(path: String, cues: Vec<CuePoint>) -> Result<(), String> {
    let saved_times = capture_mtime(&path);
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if is_id3_format(&ext) {
        let mut tag = id3::Tag::read_from_path(p).unwrap_or_else(|_| id3::Tag::new());
        tag.remove_encapsulated_object(Some("application/octet-stream"), Some(""), Some("Serato Markers2"), None::<&[u8]>);
        if !cues.is_empty() {
            let payload = build_serato_markers2(&cues);
            let b64_bytes = base64::engine::general_purpose::STANDARD.encode(&payload).into_bytes();
            tag.add_frame(id3::Frame::with_content("GEOB", id3::Content::EncapsulatedObject(
                id3::frame::EncapsulatedObject {
                    mime_type: "application/octet-stream".to_string(),
                    filename: String::new(),
                    description: "Serato Markers2".to_string(),
                    data: b64_bytes,
                }
            )));
        }
        tag.write_to_path(p, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    } else {
        save_cue_sidecar(p, &cues)?;
    }
    restore_mtime(&path, saved_times);
    Ok(())
}

// ── Track ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Track {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub bpm: Option<String>,
    pub key: Option<String>,
    pub rating: Option<u8>,
    pub duration_secs: Option<f64>,
    pub file_size_bytes: u64,
    pub has_cover: bool,
    pub cover_version: u32,
    pub issues: Vec<String>,
    pub format: String,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate_hz: Option<u32>,
    pub modified_at: Option<i64>,
    pub comment: Option<String>,
    pub total_tracks: Option<u32>,
    #[serde(default)]
    pub cue_points: Vec<CuePoint>,
    #[serde(default)]
    pub beat_phase_ms: Option<f32>,
    #[serde(default)]
    pub beat_anchors: Option<Vec<BeatAnchor>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BeatAnchor {
    pub beat_index: u32,
    pub position_ms: f32,
}

#[derive(Serialize, Deserialize)]
struct CacheData {
    tracks: Vec<Track>,
    last_folder: String,
}

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "aiff", "aif", "wav", "m4a", "mp4", "aac", "ogg", "opus", "wma",
];

fn file_format(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_uppercase())
        .unwrap_or_else(|| "?".into())
        .to_string()
}

// Varre cabeçalhos de frames ID3v2 para detectar APIC (capa) e GEOB (Serato).
// Lê apenas 10 bytes por frame — não carrega nenhum dado de imagem.
fn scan_id3_frames(path: &Path) -> (bool, bool) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return (false, false); };
    let mut hdr = [0u8; 10];
    if f.read_exact(&mut hdr).is_err() || &hdr[0..3] != b"ID3" { return (false, false); }
    let ver = hdr[3]; // 3 = ID3v2.3 (big-endian sizes), 4 = ID3v2.4 (syncsafe)
    let tag_size: u32 = ((hdr[6] as u32 & 0x7F) << 21) | ((hdr[7] as u32 & 0x7F) << 14)
        | ((hdr[8] as u32 & 0x7F) << 7) | (hdr[9] as u32 & 0x7F);
    let mut has_cover = false;
    let mut has_serato = false;
    let mut pos: u32 = 0;
    while pos + 10 <= tag_size {
        let mut fhdr = [0u8; 10];
        if f.read_exact(&mut fhdr).is_err() { break; }
        if fhdr[0..4] == [0u8; 4] { break; } // padding
        let fsize: u32 = if ver >= 4 {
            ((fhdr[4] as u32 & 0x7F) << 21) | ((fhdr[5] as u32 & 0x7F) << 14)
            | ((fhdr[6] as u32 & 0x7F) << 7) | (fhdr[7] as u32 & 0x7F)
        } else {
            u32::from_be_bytes([fhdr[4], fhdr[5], fhdr[6], fhdr[7]])
        };
        if &fhdr[0..4] == b"APIC" { has_cover = true; }
        if &fhdr[0..4] == b"GEOB" { has_serato = true; }
        if has_cover && has_serato { break; }
        pos += 10 + fsize;
        if f.seek(SeekFrom::Current(fsize as i64)).is_err() { break; }
    }
    (has_cover, has_serato)
}

// Varre blocos de metadados FLAC para detectar bloco PICTURE (tipo 6).
// Lê apenas 4 bytes por bloco — não carrega dados de imagem.
fn scan_flac_has_cover(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return false; };
    let mut sig = [0u8; 4];
    if f.read_exact(&mut sig).is_err() || &sig != b"fLaC" { return false; }
    loop {
        let mut blk = [0u8; 4];
        if f.read_exact(&mut blk).is_err() { return false; }
        let is_last = (blk[0] & 0x80) != 0;
        let btype   = blk[0] & 0x7F;
        let blen: u32 = ((blk[1] as u32) << 16) | ((blk[2] as u32) << 8) | (blk[3] as u32);
        if btype == 6 { return true; } // PICTURE block encontrado
        if is_last    { return false; }
        if f.seek(SeekFrom::Current(blen as i64)).is_err() { return false; }
    }
}

fn read_track(path: &Path) -> Option<Track> {
    let metadata = fs::metadata(path).ok()?;
    let file_size_bytes = metadata.len();
    let filename = path.file_name()?.to_string_lossy().to_string();
    let modified_at = metadata.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    let format = file_format(path);

    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let id = format!("{:x}", hasher.finalize())[..16].to_string();

    let is_id3_format = format == "MP3" || format == "AIFF" || format == "AIF" || format == "WAV";
    let is_flac = format == "FLAC";

    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut genre: Option<String> = None;
    let mut year: Option<u32> = None;
    let mut track_number: Option<u32> = None;
    let mut has_cover = false;
    let mut bpm: Option<String> = None;
    let mut key: Option<String> = None;
    let mut rating: Option<u8> = None;
    let mut comment: Option<String> = None;
    let mut total_tracks: Option<u32> = None;
    let mut cue_points: Vec<CuePoint> = Vec::new();
    let mut beat_phase_ms: Option<f32> = None;
    let mut beat_anchors: Option<Vec<BeatAnchor>> = None;
    let mut duration_secs: Option<f64> = None;
    let mut bitrate_kbps: Option<u32> = None;
    let mut sample_rate_hz: Option<u32> = None;

    if is_id3_format {
        // Scan rápido: detecta capa e Serato lendo apenas IDs de frames (sem dados)
        let (cover_found, has_serato) = scan_id3_frames(path);
        has_cover = cover_found;

        if has_serato {
            // Arquivos Serato: id3 crate necessário para GEOB frames
            // Lofty para propriedades de áudio (id3 crate não lê duração/bitrate)
            let tagged = Probe::open(path).ok()?.options(ParseOptions::new().read_tags(false)).read().ok()?;
            let props = tagged.properties();
            duration_secs = Some(props.duration().as_secs_f64()).filter(|&d| d > 0.0);
            bitrate_kbps  = props.audio_bitrate();
            sample_rate_hz = props.sample_rate();

            if let Ok(id3tag) = id3::Tag::read_from_path(path) {
                title  = id3tag.title().map(|s| s.to_string()).filter(|s| !s.is_empty());
                artist = id3tag.artist().map(|s| s.to_string()).filter(|s| !s.is_empty());
                album  = id3tag.album().map(|s| s.to_string()).filter(|s| !s.is_empty());
                genre  = id3tag.genre().map(|s| s.to_string()).filter(|s| !s.is_empty());
                year   = id3tag.year().map(|y| y as u32);
                track_number = id3tag.track();
                bpm = id3tag.frames().find(|f| f.id() == "TBPM").and_then(|f| {
                    if let id3::Content::Text(t) = f.content() {
                        let s = t.trim().to_string();
                        if s.parse::<f64>().map(|v| v >= 20.0 && v <= 300.0).unwrap_or(false) { Some(s) } else { None }
                    } else { None }
                });
                key = id3tag.frames().find(|f| f.id() == "TKEY").and_then(|f| {
                    if let id3::Content::Text(t) = f.content() { Some(t.trim().to_string()) } else { None }
                }).filter(|s| !s.is_empty());
                rating = id3tag.extended_texts()
                    .find(|e| e.description.eq_ignore_ascii_case("rating"))
                    .and_then(|e| e.value.trim().parse::<u8>().ok())
                    .filter(|&r| r >= 1 && r <= 5);
                comment = id3tag.comments().next().map(|c| c.text.clone()).filter(|s| !s.is_empty());
                total_tracks = id3tag.frames().find(|f| f.id() == "TRCK").and_then(|f| {
                    if let id3::Content::Text(t) = f.content() {
                        t.split('/').nth(1).and_then(|s| s.trim().parse::<u32>().ok())
                    } else { None }
                });
                cue_points = parse_serato_cue_points(&id3tag);
                beat_phase_ms = id3tag.extended_texts()
                    .find(|e| e.description == "TAGWAVE_BEAT_PHASE")
                    .and_then(|e| e.value.parse::<f32>().ok());
                beat_anchors = id3tag.extended_texts()
                    .find(|e| e.description == "TAGWAVE_BEAT_ANCHORS")
                    .and_then(|e| serde_json::from_str::<Vec<BeatAnchor>>(&e.value).ok());
            }
        } else {
            // Sem Serato: Lofty com read_cover_art(false) — não carrega dados de imagem
            // Para arquivos com capas embutidas, isso economiza 100-500KB por arquivo de disco
            let tagged = Probe::open(path).ok()?
                .options(ParseOptions::new().read_cover_art(false))
                .read().ok()?;
            let props = tagged.properties();
            duration_secs  = Some(props.duration().as_secs_f64()).filter(|&d| d > 0.0);
            bitrate_kbps   = props.audio_bitrate();
            sample_rate_hz = props.sample_rate();
            let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
            title  = tag.and_then(|t| t.title()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            artist = tag.and_then(|t| t.artist()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            album  = tag.and_then(|t| t.album()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            genre  = tag.and_then(|t| t.genre()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            year   = tag.and_then(|t| t.year()).map(|y| y as u32);
            track_number = tag.and_then(|t| t.track());
            total_tracks = tag.and_then(|t| t.track_total());
            bpm = tag.and_then(|t| t.get_string(&LoftyKey::Bpm)).map(|s| s.to_string())
                .filter(|s| s.parse::<f64>().map(|v| v >= 20.0 && v <= 300.0).unwrap_or(false));
            key = tag.and_then(|t| t.get_string(&LoftyKey::InitialKey))
                .map(|s| s.to_string()).filter(|s| !s.is_empty());
            comment = tag.and_then(|t| t.get_string(&LoftyKey::Comment))
                .map(|s| s.to_string()).filter(|s| !s.is_empty());
            rating = tag.and_then(|t| t.get_string(&LoftyKey::Unknown("rating".to_string())))
                .and_then(|v| v.trim().parse::<u8>().ok()).filter(|&r| r >= 1 && r <= 5);
            beat_phase_ms = tag.and_then(|t| t.get_string(&LoftyKey::Unknown("TAGWAVE_BEAT_PHASE".to_string())))
                .and_then(|v| v.parse::<f32>().ok());
            beat_anchors = tag.and_then(|t| t.get_string(&LoftyKey::Unknown("TAGWAVE_BEAT_ANCHORS".to_string())))
                .and_then(|v| serde_json::from_str::<Vec<BeatAnchor>>(&v).ok());
        }
    } else {
        // FLAC/OGG/M4A: Lofty tags
        let tagged = if is_flac {
            // FLAC: pula dados de capa — economiza centenas de KB por arquivo
            Probe::open(path).ok()?.options(ParseOptions::new().read_cover_art(false)).read().ok()?
        } else {
            Probe::open(path).ok()?.read().ok()?
        };
        let props = tagged.properties();
        duration_secs  = Some(props.duration().as_secs_f64()).filter(|&d| d > 0.0);
        bitrate_kbps   = props.audio_bitrate();
        sample_rate_hz = props.sample_rate();
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        title  = tag.and_then(|t| t.title()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        artist = tag.and_then(|t| t.artist()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        album  = tag.and_then(|t| t.album()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        genre  = tag.and_then(|t| t.genre()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        year   = tag.and_then(|t| t.year()).map(|y| y as u32);
        track_number = tag.and_then(|t| t.track());
        has_cover = if is_flac {
            scan_flac_has_cover(path) // scan rápido — não carrega dados de imagem
        } else {
            tag.map(|t| !t.pictures().is_empty()).unwrap_or(false)
        };
        bpm = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Bpm))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        key = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::InitialKey))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        comment = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Comment))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        total_tracks = tag.and_then(|t| t.track_total());
        rating = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Popularimeter))
            .and_then(|s| s.parse::<u8>().ok());
        beat_anchors = load_beat_anchor_sidecar(path);
    }

    let mut issues = Vec::new();
    if title.is_none()                         { issues.push("sem título".to_string()); }
    if artist.is_none()                        { issues.push("sem artista".to_string()); }
    if genre.is_none()                         { issues.push("sem gênero".to_string()); }
    if !has_cover                              { issues.push("sem capa".to_string()); }
    if bpm.as_deref().unwrap_or("").is_empty() { issues.push("sem BPM".to_string()); }

    Some(Track {
        id, path: path.to_string_lossy().to_string(), filename, format,
        title, artist, album, genre, year, track_number, bpm, key, rating,
        duration_secs, file_size_bytes, has_cover, cover_version: 0, issues,
        bitrate_kbps, sample_rate_hz, modified_at, comment, total_tracks, cue_points,
        beat_phase_ms, beat_anchors,
    })
}

// ── Scan & Tags ───────────────────────────────────────────────────────────────

#[tauri::command]
fn count_audio_files(folder: String) -> usize {
    WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension()
                    .map(|ext| AUDIO_EXTENSIONS.iter().any(|&a| ext.eq_ignore_ascii_case(a)))
                    .unwrap_or(false)
        })
        .count()
}

#[tauri::command]
fn cancel_current_scan() {
    SCAN_GEN.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
fn scan_folder(folder: String, app: tauri::AppHandle) -> Vec<Track> {
    let _scan_start = std::time::Instant::now();
    let my_gen = SCAN_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    // ── 1. Walk: coleta paths (leitura de diretório, sem IO de arquivo) ──────
    let mut all_paths: Vec<std::path::PathBuf> = Vec::new();
    let mut skipped_count = 0usize;
    for entry in WalkDir::new(&folder).into_iter().filter_map(|e| e.ok()) {
        if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return vec![]; }
        if !entry.file_type().is_file() { continue; }
        let name = entry.file_name().to_string_lossy();
        if name.starts_with('.') || name.starts_with("._") { continue; }
        let is_audio = entry.path().extension()
            .map(|ext| AUDIO_EXTENSIONS.iter().any(|&a| ext.eq_ignore_ascii_case(a)))
            .unwrap_or(false);
        if is_audio { all_paths.push(entry.path().to_path_buf()); }
        else { skipped_count += 1; }
    }

    if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return vec![]; }

    let total = all_paths.len();
    let _ = app.emit("scan_progress", serde_json::json!({ "done": 0, "total": total }));

    // ── 2. Cache read: busca em lote no SQLite (única lock, microsegundos) ───
    let cache_hits = read_cache_batch(&all_paths);
    let cache_hit_count = cache_hits.len();

    if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return vec![]; }

    // ── 3. Rayon: cache hit → retorna; cache miss → lê arquivo ───────────────
    let counter = Arc::new(AtomicUsize::new(0));
    let app_events = app.clone();

    struct CacheEntry { path: String, mtime: u64, data: String }

    let results: Vec<Option<(Track, Option<CacheEntry>)>> = all_paths.par_iter().map(|path| {
        if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return None; }

        let path_str = path.to_string_lossy().to_string();

        let (track, new_entry) = if let Some(cached) = cache_hits.get(&path_str) {
            (cached.clone(), None)
        } else {
            let t = read_track(path)?;
            let mtime = file_mtime(path);
            let data = serde_json::to_string(&t).unwrap_or_default();
            (t, Some(CacheEntry { path: path_str.clone(), mtime, data }))
        };

        let done = counter.fetch_add(1, Ordering::Relaxed) + 1;
        if done % 20 == 0 || done == total {
            let _ = app_events.emit("scan_progress", serde_json::json!({ "done": done, "total": total }));
        }

        Some((track, new_entry))
    }).collect();

    if skipped_count > 0 {
        let _ = app.emit("scan_skipped", serde_json::json!({ "count": skipped_count }));
    }

    // ── 4. Cache write: grava novos em lote (única transação) ─────────────────
    let new_entries: Vec<(String, u64, String)> = results.iter()
        .filter_map(|r| r.as_ref()?.1.as_ref().map(|e| (e.path.clone(), e.mtime, e.data.clone())))
        .collect();
    write_cache_batch(new_entries);

    let tracks: Vec<Track> = results.into_iter().filter_map(|r| Some(r?.0)).collect();

    dlog!("[PERF] scan_folder '{}': {} faixas em {:.2}s ({} cache, {} lidos)",
        folder.split(|c| c == '/' || c == '\\').last().unwrap_or(&folder),
        tracks.len(), _scan_start.elapsed().as_secs_f64(),
        cache_hit_count, tracks.len().saturating_sub(cache_hit_count)
    );

    tracks
}

// Remove flag imutável e bit read-only antes de escrever (exFAT mapeia seu atributo
// read-only tanto para uchg quanto para as permissões Unix, então ambos precisam ser limpos).
fn ensure_writable(path: &str) {
    #[cfg(target_os = "macos")]
    { let _ = Command::new("chflags").args(["nouchg", path]).output(); }
    // Limpa o bit read-only via fs (cobre exFAT no macOS e arquivos somente-leitura no Windows)
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

/// Captura mtime+atime antes de escrever tags; retorna opaco para restore_mtime.
/// Editar tags não deve alterar a data de modificação do arquivo —
/// DJ softwares (Rekordbox, Serato) usam o mtime como "data adicionada à biblioteca".
fn capture_mtime(path: &str) -> Option<(std::time::SystemTime, std::time::SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.accessed().ok()?))
}

/// Restaura mtime+atime após escrita de tags.
fn restore_mtime(path: &str, saved: Option<(std::time::SystemTime, std::time::SystemTime)>) {
    if let Some((mtime, atime)) = saved {
        if let Ok(f) = std::fs::OpenOptions::new().write(true).open(path) {
            let ft = std::fs::FileTimes::new().set_modified(mtime).set_accessed(atime);
            let _ = f.set_times(ft);
        }
    }
}

#[tauri::command]
fn save_tags(
    path: String, title: Option<String>, artist: Option<String>,
    album: Option<String>, genre: Option<String>, year: Option<u32>,
    track_number: Option<u32>, bpm: Option<String>, key: Option<String>,
    rating: Option<u8>, comment: Option<String>, total_tracks: Option<u32>,
) -> Result<(), String> {
    let saved_times = capture_mtime(&path);
    let fmt = file_format(Path::new(&path));
    if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" || fmt == "WAV" {
        // id3 para formatos que usam ID3v2 nativamente (WAV = ID3v2 em chunk RIFF)
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
        if let Some(v) = title        { tag.set_title(v); }
        if let Some(v) = artist       { tag.set_artist(v); }
        if let Some(v) = album        { tag.set_album(v); }
        if let Some(v) = genre        { tag.set_genre(v); }
        if let Some(v) = year         { tag.set_year(v as i32); }
        match (track_number, total_tracks) {
            (Some(tn), Some(tt)) => { tag.add_frame(id3::Frame::text("TRCK", format!("{}/{}", tn, tt))); }
            (Some(tn), None)     => { tag.set_track(tn); }
            (None, Some(tt))     => {
                let existing = tag.track().unwrap_or(0);
                tag.add_frame(id3::Frame::text("TRCK", format!("{}/{}", existing, tt)));
            }
            (None, None) => {}
        }
        if let Some(v) = bpm  { if !v.is_empty() { tag.add_frame(id3::Frame::text("TBPM", v)); } }
        if let Some(v) = key  { if !v.is_empty() { tag.add_frame(id3::Frame::text("TKEY", v)); } }
        if let Some(r) = rating {
            tag.remove_extended_text(Some("RATING"), None);
            tag.add_frame(id3::frame::ExtendedText { description: "RATING".to_string(), value: r.to_string() });
        }
        if let Some(v) = comment {
            tag.remove("COMM");
            if !v.is_empty() {
                tag.add_frame(Id3Comment { lang: "por".to_string(), description: String::new(), text: v });
            }
        }
        ensure_writable(&path);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    } else {
        // lofty para FLAC, OGG, OPUS, M4A, AAC, WMA, etc. (WAV usa id3 acima)
        let mut tagged = Probe::open(&path).map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let tag = tagged.primary_tag_mut().ok_or("sem tag")?;
        if let Some(v) = title        { tag.set_title(v.into()); }
        if let Some(v) = artist       { tag.set_artist(v.into()); }
        if let Some(v) = album        { tag.set_album(v.into()); }
        if let Some(v) = genre        { tag.set_genre(v.into()); }
        if let Some(v) = year         { tag.set_year(v); }
        if let Some(v) = track_number { tag.set_track(v); }
        if let Some(v) = total_tracks { tag.set_track_total(v); }
        if let Some(v) = bpm    { if !v.is_empty() { tag.insert(LoftyItem::new(LoftyKey::Bpm,        LoftyVal::Text(v))); } }
        if let Some(v) = key    { if !v.is_empty() { tag.insert(LoftyItem::new(LoftyKey::InitialKey, LoftyVal::Text(v))); } }
        if let Some(v) = comment { if !v.is_empty() { tag.insert(LoftyItem::new(LoftyKey::Comment,  LoftyVal::Text(v))); } }
        // FLAC/OGG/M4A: Popularimeter → campo de texto persistido pelo lofty
        if let Some(r) = rating { tag.insert(LoftyItem::new(LoftyKey::Popularimeter, LoftyVal::Text(r.to_string()))); }
        ensure_writable(&path);
        tagged.save_to_path(&path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())?;
    }
    restore_mtime(&path, saved_times);
    Ok(())
}

#[tauri::command]
async fn save_cover(path: String, cover_url: String) -> Result<(), String> {
    let saved_times = capture_mtime(&path);
    let client = cover_client();
    let cover_data = client.get(&cover_url).send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?.to_vec();
    let fmt = file_format(Path::new(&path));
    let result = if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" {
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
        tag.remove("APIC");
        tag.add_frame(Picture {
            mime_type: "image/jpeg".to_string(),
            picture_type: PictureType::CoverFront,
            description: String::new(),
            data: cover_data,
        });
        ensure_writable(&path);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())
    } else {
        let mut tagged = Probe::open(&path).map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let tag = tagged.primary_tag_mut().ok_or("sem tag")?;
        tag.remove_picture_type(LoftyPicType::CoverFront);
        tag.push_picture(LoftyPic::new_unchecked(LoftyPicType::CoverFront, Some(LoftyMime::Jpeg), None, cover_data));
        ensure_writable(&path);
        tagged.save_to_path(&path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())
    };
    restore_mtime(&path, saved_times);
    result
}

#[tauri::command]
fn save_cover_from_file(path: String, image_path: String) -> Result<(), String> {
    let saved_times = capture_mtime(&path);
    let cover_data = fs::read(&image_path).map_err(|e| e.to_string())?;
    let is_png = image_path.to_lowercase().ends_with(".png");
    let fmt = file_format(Path::new(&path));
    let result = if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" || fmt == "WAV" {
        let mime = if is_png { "image/png".to_string() } else { "image/jpeg".to_string() };
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
        tag.remove("APIC");
        tag.add_frame(Picture {
            mime_type: mime,
            picture_type: PictureType::CoverFront,
            description: String::new(),
            data: cover_data,
        });
        ensure_writable(&path);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())
    } else {
        let lofty_mime = if is_png { LoftyMime::Png } else { LoftyMime::Jpeg };
        let mut tagged = Probe::open(&path).map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let has_primary = tagged.primary_tag().is_some();
        let tag = if has_primary {
            tagged.primary_tag_mut().unwrap()
        } else {
            tagged.first_tag_mut().ok_or("sem tag")?
        };
        tag.remove_picture_type(LoftyPicType::CoverFront);
        tag.push_picture(LoftyPic::new_unchecked(LoftyPicType::CoverFront, Some(lofty_mime), None, cover_data));
        ensure_writable(&path);
        tagged.save_to_path(&path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())
    };
    restore_mtime(&path, saved_times);
    result
}

/// Aplica capa a partir de dados base64 — alternativa ao save_cover_from_file para evitar
/// dupla abertura de arquivo no Windows (imagem + áudio).
#[tauri::command]
fn save_cover_b64(path: String, b64: String, is_png: bool) -> Result<(), String> {
    use base64::Engine as _;
    let cover_data = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| e.to_string())?;
    let fmt = file_format(Path::new(&path));
    if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" || fmt == "WAV" {
        let mime = if is_png { "image/png".to_string() } else { "image/jpeg".to_string() };
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
        tag.remove("APIC");
        tag.add_frame(Picture {
            mime_type: mime,
            picture_type: PictureType::CoverFront,
            description: String::new(),
            data: cover_data,
        });
        ensure_writable(&path);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())
    } else {
        let lofty_mime = if is_png { LoftyMime::Png } else { LoftyMime::Jpeg };
        let mut tagged = Probe::open(&path).map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let has_primary = tagged.primary_tag().is_some();
        let tag = if has_primary {
            tagged.primary_tag_mut().unwrap()
        } else {
            tagged.first_tag_mut().ok_or("sem tag")?
        };
        tag.remove_picture_type(LoftyPicType::CoverFront);
        tag.push_picture(LoftyPic::new_unchecked(LoftyPicType::CoverFront, Some(lofty_mime), None, cover_data));
        ensure_writable(&path);
        tagged.save_to_path(&path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())
    }
}

// ── PRO: Extended Tags ──────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct RawTag { key: String, value: String }

#[tauri::command]
fn read_all_tags(path: String) -> Result<Vec<RawTag>, String> {
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mut result: Vec<RawTag> = Vec::new();

    if matches!(ext.as_str(), "mp3" | "aiff" | "aif") {
        let tag = id3::Tag::read_from_path(&path).unwrap_or_default();
        for frame in tag.frames() {
            let key = frame.id().to_string();
            let value = match frame.content() {
                id3::Content::Text(t) => t.clone(),
                id3::Content::ExtendedText(et) => format!("{}: {}", et.description, et.value),
                id3::Content::Comment(c) => c.text.clone(),
                id3::Content::Lyrics(l) => l.text.clone(),
                id3::Content::Link(l) => l.clone(),
                _ => "(binary)".to_string(),
            };
            result.push(RawTag { key, value });
        }
    } else {
        let tagged = lofty::probe::Probe::open(&path)
            .map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        if let Some(t) = tag {
            for item in t.items() {
                let key = format!("{:?}", item.key());
                let value = match item.value() {
                    lofty::tag::ItemValue::Text(s) => s.clone(),
                    lofty::tag::ItemValue::Locator(s) => s.clone(),
                    _ => "(binary)".to_string(),
                };
                result.push(RawTag { key, value });
            }
        }
    }
    Ok(result)
}

#[tauri::command]
fn save_raw_tag(path: String, key: String, value: String) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if matches!(ext.as_str(), "mp3" | "aiff" | "aif") {
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_default();
        tag.set_text(&key, &value);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_raw_tag(path: String, key: String) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if matches!(ext.as_str(), "mp3" | "aiff" | "aif") {
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_default();
        tag.remove(&key);
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── PRO: AcoustID Fingerprint ────────────────────────────────────────────────

#[tauri::command]
async fn get_acoustid_fingerprint(path: String, api_key: String) -> Result<serde_json::Value, String> {
    // Decodifica PCM via symphonia (já temos essa infra)
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = symphonia::core::probe::Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .map_err(|e| e.to_string())?;
    let mut reader = probed.format;
    let track = reader.default_track().ok_or("No audio track")?.clone();
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &Default::default())
        .map_err(|e| e.to_string())?;

    let mut samples: Vec<i16> = Vec::new();
    let mut duration_secs = 0u32;

    loop {
        let packet = match reader.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track.id { continue; }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };
        duration_secs = (decoded.frames() as u32 / sample_rate).max(duration_secs);
        #[allow(unused_imports)]
        use symphonia::core::audio::Signal;
        let spec = *decoded.spec();
        let mut buf = symphonia::core::audio::SampleBuffer::<i16>::new(decoded.frames() as u64, spec);
        buf.copy_interleaved_ref(decoded);
        samples.extend_from_slice(buf.samples());
        if samples.len() > sample_rate as usize * channels * 120 { break; } // max 2min
    }

    // Estima duração real
    if duration_secs == 0 {
        duration_secs = (samples.len() / (sample_rate as usize * channels)) as u32;
    }

    // Gera fingerprint simples (hash das amostras) — substituir por chromaprint real em v2
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    samples[..samples.len().min(sample_rate as usize * 2)].hash(&mut hasher);
    let fp = format!("{:x}", hasher.finish());

    // Chama AcoustID API
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.acoustid.org/v2/lookup")
        .query(&[
            ("client", api_key.as_str()),
            ("fingerprint", fp.as_str()),
            ("duration", &duration_secs.to_string()),
            ("meta", "recordings releases"),
        ])
        .send().await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>().await
        .map_err(|e| e.to_string())?;

    Ok(resp)
}

#[tauri::command]
fn read_cover_base64(path: String) -> Option<String> {
    let tagged = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let pic = tag.pictures().first()?;
    Some(base64::engine::general_purpose::STANDARD.encode(pic.data()))
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path.replace('/', "\\"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path.replace('/', "\\")])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn dir_exists(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
fn check_paths_exist(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| !Path::new(p).exists()).collect()
}

#[tauri::command]
fn list_subfolders(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut subs: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();
    subs.sort_by(|a, b| {
        let na = Path::new(a).file_name().unwrap_or_default().to_string_lossy();
        let nb = Path::new(b).file_name().unwrap_or_default().to_string_lossy();
        na.to_lowercase().cmp(&nb.to_lowercase())
    });
    Ok(subs)
}

#[derive(Serialize, Clone)]
struct FsDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    has_subdirs: bool,
    audio_count: u32,
}

#[tauri::command]
fn list_dir_contents(path: String) -> Result<Vec<FsDirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result: Vec<FsDirEntry> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let entry_path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            // Não abre a subpasta — mesma velocidade do Finder
            // has_subdirs=true conservativo: mostra "›" em todas as pastas
            result.push(FsDirEntry { name, path: entry_path.to_string_lossy().to_string(), is_dir: true, has_subdirs: true, audio_count: 0 });
        } else {
            let is_audio = entry_path.extension()
                .and_then(|e| e.to_str())
                .map(|e| AUDIO_EXTENSIONS.iter().any(|&a| e.eq_ignore_ascii_case(a)))
                .unwrap_or(false);
            if is_audio {
                result.push(FsDirEntry { name, path: entry_path.to_string_lossy().to_string(), is_dir: false, has_subdirs: false, audio_count: 0 });
            }
        }
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

#[tauri::command]
fn list_volumes() -> Vec<serde_json::Value> {
    #[cfg(target_os = "macos")]
    {
        let mut vols = vec![];
        if let Ok(entries) = fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                let path = entry.path();
                // Ignora symlinks (ex: "Macintosh HD" aponta para "/", não é volume real para música)
                if path.is_symlink() { continue; }
                if !path.is_dir() { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                // Filtra nomes que parecem arquivos temporários/DMG montados automaticamente
                // Padrão: contém "." e parece hash/temp (ex: dmg.EtYWkF, com.apple.xxx, disk.xxx)
                let looks_temp = name.contains('.')
                    && (name.starts_with("dmg.")
                        || name.starts_with("com.")
                        || name.starts_with("disk.")
                        || name.starts_with("._")
                        // Nome com "." e sem espaços e com chars aleatórios (provável hash de 6+ chars após o ponto)
                        || name.split('.').last().map(|s| s.len() >= 6 && s.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or(false));
                if looks_temp { continue; }
                vols.push(serde_json::json!({ "path": path.to_string_lossy(), "name": name }));
            }
        }
        vols.sort_by(|a, b| {
            let na = a["name"].as_str().unwrap_or("").to_lowercase();
            let nb = b["name"].as_str().unwrap_or("").to_lowercase();
            na.cmp(&nb)
        });
        vols
    }
    #[cfg(target_os = "windows")]
    {
        let mut vols = vec![];
        for letter in b'C'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            let p = Path::new(&path);
            if p.exists() {
                vols.push(serde_json::json!({ "path": path, "name": format!("Drive {}", letter as char) }));
            }
        }
        vols
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { vec![] }
}

// ── Waveform ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn generate_waveform(path: String, bars: usize) -> Result<Vec<f32>, String> {
    use std::io::{Read, Seek, SeekFrom};

    if bars == 0 { return Ok(vec![]); }

    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let file_len = file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())? as usize;

    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hdr = [0u8; 10];
    let audio_start = if file.read(&mut hdr).ok() == Some(10) && &hdr[..3] == b"ID3" {
        let sz = ((hdr[6] as usize & 0x7F) << 21)
               | ((hdr[7] as usize & 0x7F) << 14)
               | ((hdr[8] as usize & 0x7F) << 7)
               | (hdr[9] as usize & 0x7F);
        (10 + sz).min(file_len)
    } else { 0 };

    let audio_len = file_len.saturating_sub(audio_start);
    if audio_len < bars { return Ok(vec![0.3; bars]); }

    const SAMPLE_BYTES: usize = 4096;
    let bar_span = audio_len / bars;
    let mut buf = vec![0u8; SAMPLE_BYTES];
    let mut result = vec![0.0f32; bars];

    for i in 0..bars {
        let pos = audio_start + i * bar_span;
        if file.seek(SeekFrom::Start(pos as u64)).is_err() { continue; }
        let n = file.read(&mut buf).unwrap_or(0);
        if n == 0 { continue; }
        let sum: u64 = buf[..n].iter()
            .map(|&b| (b as i16 - 128).unsigned_abs() as u64)
            .sum();
        result[i] = sum as f32 / (n as f32 * 128.0);
    }

    let max = result.iter().cloned().fold(0.0f32, f32::max);
    if max > 0.0 { result.iter_mut().for_each(|v| *v /= max); }
    Ok(result)
}

/// Estima o BPM via detecção de picos na envoltória de energia do áudio.
/// `duration_secs`: duração real da faixa (em segundos), necessária para calibrar o tempo por janela.
#[tauri::command]
fn analyze_bpm(path: String, duration_secs: f32) -> Result<Option<f32>, String> {
    use std::io::{Read, Seek, SeekFrom};

    let fname = path.split(|c| c == '/' || c == '\\').last().unwrap_or(&path).to_string();

    if duration_secs <= 0.0 {
        dlog!("[BPM] {} — SKIP: duration_secs={}", fname, duration_secs);
        return Ok(None);
    }

    const BARS: usize = 2048; // alta resolução temporal
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let file_len = file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())? as usize;

    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hdr = [0u8; 12];
    let _ = file.read(&mut hdr);

    // Detecta cabeçalho por magic bytes e calcula audio_start
    let audio_start = if &hdr[..3] == b"ID3" {
        // MP3 com tag ID3v2: tamanho codificado em sincronia segura
        let sz = ((hdr[6] as usize & 0x7F) << 21)
               | ((hdr[7] as usize & 0x7F) << 14)
               | ((hdr[8] as usize & 0x7F) << 7)
               | (hdr[9] as usize & 0x7F);
        dlog!("[BPM] {} — formato: MP3/ID3, skip {} bytes", fname, 10 + sz);
        (10 + sz).min(file_len)
    } else if &hdr[..4] == b"fLaC" {
        // FLAC: pula metadados até encontrar blocos de áudio
        // Heurística: os metadados FLAC raramente ultrapassam 128 KB
        let skip = (128 * 1024).min(file_len / 4);
        dlog!("[BPM] {} — formato: FLAC, skip heurístico {} bytes", fname, skip);
        skip
    } else if &hdr[..4] == b"RIFF" && &hdr[8..12] == b"WAVE" {
        // WAV: procura o chunk 'data'
        let mut pos: usize = 12;
        let mut data_start = pos;
        file.seek(SeekFrom::Start(pos as u64)).ok();
        let mut chunk_hdr = [0u8; 8];
        while pos + 8 < file_len {
            if file.read_exact(&mut chunk_hdr).is_err() { break; }
            let chunk_id = &chunk_hdr[..4];
            let chunk_sz = u32::from_le_bytes([chunk_hdr[4], chunk_hdr[5], chunk_hdr[6], chunk_hdr[7]]) as usize;
            if chunk_id == b"data" {
                data_start = pos + 8;
                break;
            }
            pos += 8 + chunk_sz;
            if file.seek(SeekFrom::Start(pos as u64)).is_err() { break; }
        }
        dlog!("[BPM] {} — formato: WAV, data chunk em {} bytes", fname, data_start);
        data_start
    } else if &hdr[4..8] == b"ftyp" {
        // M4A / AAC / MP4 container — pula para mdat heuristicamente
        let skip = (4 * 1024).min(file_len / 4);
        dlog!("[BPM] {} — formato: M4A/MP4, skip heurístico {} bytes", fname, skip);
        skip
    } else {
        dlog!("[BPM] {} — formato desconhecido (magic={:?}), começa em 0", fname, &hdr[..4]);
        0
    };

    let audio_len = file_len.saturating_sub(audio_start);
    if audio_len < BARS {
        dlog!("[BPM] {} — SKIP: audio_len={} < {}", fname, audio_len, BARS);
        return Ok(None);
    }

    let bar_span = audio_len / BARS;
    let secs_per_bar = duration_secs / BARS as f32;

    const SAMPLE_BYTES: usize = 2048;
    let mut buf = vec![0u8; SAMPLE_BYTES];
    let mut energy = vec![0.0f32; BARS];

    for i in 0..BARS {
        let pos = audio_start + i * bar_span;
        if file.seek(SeekFrom::Start(pos as u64)).is_err() { continue; }
        let n = file.read(&mut buf).unwrap_or(0);
        if n == 0 { continue; }
        let sum: u64 = buf[..n].iter().map(|&b| {
            let v = b as i32 - 128;
            (v * v) as u64
        }).sum();
        energy[i] = (sum as f32 / n as f32).sqrt();
    }

    // Onset strength: diferença positiva entre frames adjacentes
    let onset: Vec<f32> = energy.windows(2)
        .map(|w| (w[1] - w[0]).max(0.0))
        .collect();

    let mean_onset = onset.iter().sum::<f32>() / onset.len() as f32;

    // Encontra picos com gap mínimo de 200ms
    // Threshold mais permissivo (1.4x) para funcionar em mais formatos
    let min_gap = ((0.20 / secs_per_bar) as usize).max(4);
    let threshold = mean_onset * 1.4;

    let mut peaks: Vec<usize> = Vec::new();
    let mut i = 0;
    while i < onset.len() {
        if onset[i] > threshold {
            let end = (i + min_gap).min(onset.len());
            let local_max_idx = onset[i..end].iter().enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(j, _)| i + j)
                .unwrap_or(i);
            peaks.push(local_max_idx);
            i = local_max_idx + min_gap;
        } else {
            i += 1;
        }
    }

    dlog!("[BPM] {} — picos={} mean_onset={:.4} threshold={:.4}", fname, peaks.len(), mean_onset, threshold);

    if peaks.len() < 6 {
        dlog!("[BPM] {} — SKIP: poucos picos ({})", fname, peaks.len());
        return Ok(None);
    }

    // Intervalos em segundos entre picos consecutivos
    let mut intervals: Vec<f32> = peaks.windows(2)
        .map(|w| (w[1] - w[0]) as f32 * secs_per_bar)
        .filter(|&d| d > 0.18 && d < 2.5) // 24–333 BPM brutos
        .collect();

    if intervals.is_empty() {
        dlog!("[BPM] {} — SKIP: sem intervalos válidos", fname);
        return Ok(None);
    }

    // Mediana dos intervalos
    intervals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = intervals[intervals.len() / 2];

    let mut bpm = 60.0 / median;

    // Ajusta oitavas (half/double time)
    while bpm < 70.0  { bpm *= 2.0; }
    while bpm > 200.0 { bpm /= 2.0; }

    // Arredonda para 0.5 BPM
    let bpm = (bpm * 2.0).round() / 2.0;

    dlog!("[BPM] {} — RESULTADO: {}", fname, bpm);
    Ok(Some(bpm))
}

// ── Waveform disk cache ───────────────────────────────────────────────────────

fn wave_cache_dir() -> std::path::PathBuf {
    let home = home_dir().map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    std::path::PathBuf::from(home).join(".tagwave").join("wave_cache")
}

fn wave_cache_key(path: &str, bars: usize) -> Option<String> {
    let mtime = std::fs::metadata(path).ok()?
        .modified().ok()?
        .duration_since(std::time::UNIX_EPOCH).ok()?
        .as_secs();
    let mut h = Sha256::new();
    h.update(path.as_bytes());
    h.update(mtime.to_le_bytes());
    h.update(bars.to_le_bytes());
    Some(format!("{:x}", h.finalize())[..24].to_string())
}

fn read_wave_cache(path: &str, bars: usize) -> Option<Vec<f32>> {
    let key   = wave_cache_key(path, bars)?;
    let bytes = std::fs::read(wave_cache_dir().join(format!("{}.bin", key))).ok()?;
    if bytes.len() != bars * 3 * 4 { return None; }
    Some(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

fn write_wave_cache(path: &str, bars: usize, data: &[f32]) {
    let Some(key) = wave_cache_key(path, bars) else { return };
    let dir = wave_cache_dir();
    let _ = std::fs::create_dir_all(&dir);
    let bytes: Vec<u8> = data.iter().flat_map(|&f| f.to_le_bytes()).collect();
    let _ = std::fs::write(dir.join(format!("{}.bin", key)), bytes);
}

// ── Scrub PCM cache ───────────────────────────────────────────────────────────
// Decodifica a faixa para PCM mono 22050 Hz f32-LE e salva em disco.
// Retorna o caminho do arquivo de cache para que o TypeScript leia via fetch(convertFileSrc).
// Cache hit = leitura de arquivo (ms); miss = decode completo (~1-3 s).

const SCRUB_SR: u32 = 22050;

fn pcm_cache_key(path: &str) -> Option<String> {
    let mtime = std::fs::metadata(path).ok()?
        .modified().ok()?
        .duration_since(std::time::UNIX_EPOCH).ok()?
        .as_secs();
    let mut h = Sha256::new();
    h.update(path.as_bytes());
    h.update(mtime.to_le_bytes());
    h.update(b"scrub_pcm_22050_v1");
    Some(format!("{:x}", h.finalize())[..24].to_string())
}

#[tauri::command]
fn get_scrub_pcm(path: String) -> Result<String, String> {
    let cache_dir = wave_cache_dir();
    let key = pcm_cache_key(&path).ok_or("cache key error")?;
    let cache_path = cache_dir.join(format!("{}_pcm.bin", key));

    if cache_path.exists() {
        return Ok(cache_path.to_string_lossy().into_owned());
    }

    let (mono, sample_rate) = decode_pcm_with_sr(&path)
        .map_err(|e| format!("decode: {}", e))?;

    let resampled: Vec<f32> = if sample_rate == SCRUB_SR {
        mono
    } else {
        let ratio = sample_rate as f64 / SCRUB_SR as f64;
        let out_len = (mono.len() as f64 / ratio).floor() as usize;
        (0..out_len).map(|i| {
            let src_pos = i as f64 * ratio;
            let src_i = src_pos as usize;
            let frac = (src_pos - src_i as f64) as f32;
            let a = mono.get(src_i).copied().unwrap_or(0.0);
            let b = mono.get(src_i + 1).copied().unwrap_or(0.0);
            a + (b - a) * frac
        }).collect()
    };

    let _ = std::fs::create_dir_all(&cache_dir);
    let bytes: Vec<u8> = resampled.iter().flat_map(|&f| f.to_le_bytes()).collect();
    std::fs::write(&cache_path, &bytes).map_err(|e| format!("write cache: {}", e))?;

    Ok(cache_path.to_string_lossy().into_owned())
}

// Retorna Vec de tamanho bars*3: [amp, bass, treble, ...]
#[tauri::command]
fn generate_waveform_rgb(path: String, bars: usize) -> Result<Vec<f32>, String> {
    if bars == 0 { return Ok(vec![]); }

    // Cache em disco — hit = microsegundos (sem decode de áudio)
    if let Some(cached) = read_wave_cache(&path, bars) {
        return Ok(cached);
    }

    // Decodifica com stride de packets: máximo `bars * 5` packets decodificados
    // (ex.: 400 para 80 barras) distribuídos ao longo do arquivo inteiro.
    // Para um mix de 1h com ~93 600 frames MP3 → stride ≈ 234 (decode 1 em 234).
    let result = match decode_pcm_strided(&path, bars * 5) {
        Ok(samples) if samples.len() >= bars => {
            build_waveform_rgb_from_pcm(&samples, bars)?
        }
        _ => {
            vec![0.35f32, 0.5, 0.3].into_iter().cycle().take(bars * 3).collect()
        }
    };

    write_wave_cache(&path, bars, &result);
    Ok(result)
}

/// Gera amostras PCM para waveform com dois níveis de limitação:
///
/// 1. `MAX_READ_PKTS` — hard cap no total de packets LIDOS via `next_packet()`.
///    Limita I/O e parsing de bitstream. Para um mix de 2h (~275 000 packets MP3)
///    com cap=5 000 cobrimos os primeiros ~2,6 min — suficiente para thumbnail.
///
/// 2. `packet_stride` — só chama `decoder.decode()` 1 em cada N packets lidos.
///    Limita o custo MDCT. Com target_packets=400 e MAX_READ_PKTS=5 000
///    → stride=12, ~416 decodificações independente do tamanho do arquivo.
fn decode_pcm_strided(path: &str, target_packets: usize) -> Result<Vec<f32>, Box<dyn std::error::Error + Send + Sync>> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::core::errors::Error as SymphoniaError;

    // Hard cap: nunca lê mais do que esta quantidade de packets do bitstream.
    // 5 000 packets ≈ primeiros 2,6 min de um MP3 44 100 Hz (1 152 samples/pkt).
    const MAX_READ_PKTS: usize = 5_000;

    let file = std::fs::File::open(path)?;
    let mss  = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())?;

    let mut format = probed.format;

    let track = format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("no audio track")?;

    let track_id = track.id;

    // Stride de decodificação dentro dos MAX_READ_PKTS packets lidos.
    let packet_stride = (MAX_READ_PKTS / target_packets).max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    let mut mono: Vec<f32> = Vec::with_capacity(target_packets * 1152);
    let mut read_count: usize = 0;
    let mut pkt_idx: usize = 0;

    loop {
        if read_count >= MAX_READ_PKTS { break; }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => { decoder.reset(); continue; }
            Err(_) => break,
        };
        if packet.track_id() != track_id { continue; }

        read_count += 1;
        pkt_idx    += 1;

        if pkt_idx % packet_stride != 0 { continue; }

        let audio_buf = match decoder.decode(&packet) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let spec = *audio_buf.spec();
        let ch   = spec.channels.count().max(1);
        let mut sample_buf = SampleBuffer::<f32>::new(audio_buf.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(audio_buf);

        mono.extend(sample_buf.samples().chunks(ch).map(|c| c.iter().sum::<f32>() / ch as f32));
    }

    Ok(mono)
}


// Returns (mono_samples, sample_rate_hz)
fn decode_pcm_with_sr(path: &str) -> Result<(Vec<f32>, u32), Box<dyn std::error::Error + Send + Sync>> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::core::errors::Error as SymphoniaError;

    let file = std::fs::File::open(path)?;
    let mss  = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())?;

    let mut format = probed.format;

    let track = format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("no audio track")?;

    let track_id    = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    let mut mono: Vec<f32> = Vec::with_capacity((sample_rate as usize) * 60 * 5);

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => { decoder.reset(); continue; }
            Err(_) => break,
        };
        if packet.track_id() != track_id { continue; }

        let audio_buf = match decoder.decode(&packet) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let spec = *audio_buf.spec();
        let ch = spec.channels.count().max(1);
        let mut sample_buf = SampleBuffer::<f32>::new(audio_buf.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(audio_buf);
        let samples = sample_buf.samples();

        mono.extend(samples.chunks(ch).map(|c| c.iter().sum::<f32>() / ch as f32));
    }

    Ok((mono, sample_rate))
}

fn build_waveform_rgb_from_pcm(samples: &[f32], bars: usize) -> Result<Vec<f32>, String> {
    let total = samples.len();
    let spb   = (total / bars).max(1); // samples per bar

    let mut amps    = vec![0.0f32; bars];
    let mut basses  = vec![0.0f32; bars];
    let mut trebles = vec![0.0f32; bars];

    for i in 0..bars {
        let s = i * spb;
        let e = ((i + 1) * spb).min(total);
        let sl = &samples[s..e];
        if sl.is_empty() { continue; }

        // Amplitude: blend RMS + peak para boa dinâmica visual
        let rms  = (sl.iter().map(|&x| x * x).sum::<f32>() / sl.len() as f32).sqrt();
        let peak = sl.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);
        amps[i] = rms * 0.65 + peak * 0.35;

        // Bass: energia de componentes lentos (sub-amostrado a ~100 samples)
        let step = (sl.len() / 16).max(1);
        let bass_sq: f32 = sl.chunks(step)
            .map(|c| { let a = c.iter().sum::<f32>() / c.len() as f32; a * a })
            .sum();
        basses[i] = (bass_sq / ((sl.len() / step).max(1) as f32)).sqrt();

        // Treble: energia de variações rápidas (diferenças adjacentes)
        let diff_sq: f32 = sl.windows(2).map(|w| { let d = w[1] - w[0]; d * d }).sum();
        trebles[i] = (diff_sq / (sl.len().saturating_sub(1)).max(1) as f32).sqrt();
    }

    // Normaliza canais individualmente
    let norm = |v: &mut Vec<f32>| {
        let mx = v.iter().cloned().fold(1e-9f32, f32::max);
        if mx > 1e-9 { v.iter_mut().for_each(|x| *x /= mx); }
    };
    norm(&mut amps);
    norm(&mut basses);
    norm(&mut trebles);

    // Gamma 0.55 → expande a faixa dinâmica visualmente (partes silenciosas ficam mais visíveis)
    amps.iter_mut().for_each(|a| *a = a.powf(0.55));

    let mut out = Vec::with_capacity(bars * 3);
    for i in 0..bars {
        out.push(amps[i]);
        out.push(basses[i]);
        out.push(trebles[i]);
    }
    Ok(out)
}

// ── Structure Analysis (multi-band IIR) ───────────────────────────────────────

// Discrete one-pole IIR low-pass: y[n] = (1-a)*y[n-1] + a*x[n]
// alpha = 2π·fc / (2π·fc + SR)   (bilinear-transform approximation)
#[inline]
fn one_pole_lp(samples: &[f32], alpha: f32) -> Vec<f32> {
    let mut out = Vec::with_capacity(samples.len());
    let mut y = 0.0f32;
    for &x in samples {
        y = (1.0 - alpha) * y + alpha * x;
        out.push(y);
    }
    out
}

// Returns bars * 6 floats: [sub_bass, bass, mid, treble, amp, onset]
// Bands (IIR): sub_bass <80 Hz · bass 80-300 Hz · mid 300-2500 Hz · treble >2500 Hz
fn build_structure_bands(samples: &[f32], bars: usize, sr: u32) -> Result<Vec<f32>, String> {
    let sr_f = sr as f32;
    let alpha = |fc: f32| -> f32 {
        let w = 2.0 * std::f32::consts::PI * fc;
        w / (w + sr_f)
    };

    let lp80   = one_pole_lp(samples, alpha(80.0));
    let lp300  = one_pole_lp(samples, alpha(300.0));
    let lp2500 = one_pole_lp(samples, alpha(2500.0));

    let total = samples.len();
    let spb   = (total / bars).max(1);

    let mut sub_bass = vec![0.0f32; bars];
    let mut bass_b   = vec![0.0f32; bars];
    let mut mid_b    = vec![0.0f32; bars];
    let mut treble_b = vec![0.0f32; bars];
    let mut amp_b    = vec![0.0f32; bars];
    let mut onset_b  = vec![0.0f32; bars];

    let mut pe_sub = 0.0f32;
    let mut pe_bas = 0.0f32;
    let mut pe_mid = 0.0f32;
    let mut pe_tr  = 0.0f32;

    for i in 0..bars {
        let s = i * spb;
        let e = ((i + 1) * spb).min(total);
        if s >= e { continue; }
        let n = (e - s) as f32;

        let rms = |v: &[f32]| -> f32 {
            (v.iter().map(|&x| x * x).sum::<f32>() / n).sqrt()
        };

        let e_sub = rms(&lp80[s..e.min(lp80.len())]);
        let e_bas = {
            let sq: f32 = (s..e.min(lp300.len())).map(|j| { let v = lp300[j] - lp80[j]; v*v }).sum();
            (sq / n).sqrt()
        };
        let e_mid = {
            let sq: f32 = (s..e.min(lp2500.len())).map(|j| { let v = lp2500[j] - lp300[j]; v*v }).sum();
            (sq / n).sqrt()
        };
        let e_tr = {
            let sq: f32 = (s..e.min(lp2500.len())).map(|j| { let v = samples[j] - lp2500[j]; v*v }).sum();
            (sq / n).sqrt()
        };
        let e_amp = rms(&samples[s..e]);

        // Half-rectified multi-band flux (onset strength)
        // Sub-bass onset weighted 2.5× → kick drum = most DJ-relevant transient
        let onset = (e_sub - pe_sub).max(0.0) * 2.5
                  + (e_bas - pe_bas).max(0.0) * 1.5
                  + (e_mid - pe_mid).max(0.0) * 1.0
                  + (e_tr  - pe_tr ).max(0.0) * 0.6;

        sub_bass[i] = e_sub;
        bass_b[i]   = e_bas;
        mid_b[i]    = e_mid;
        treble_b[i] = e_tr;
        amp_b[i]    = e_amp;
        onset_b[i]  = onset;

        pe_sub = e_sub;
        pe_bas = e_bas;
        pe_mid = e_mid;
        pe_tr  = e_tr;
    }

    let norm = |v: &mut Vec<f32>| {
        let mx = v.iter().cloned().fold(1e-9f32, f32::max);
        if mx > 1e-9 { v.iter_mut().for_each(|x| *x /= mx); }
    };
    norm(&mut sub_bass);
    norm(&mut bass_b);
    norm(&mut mid_b);
    norm(&mut treble_b);
    norm(&mut amp_b);
    norm(&mut onset_b);

    let mut out = Vec::with_capacity(bars * 6);
    for i in 0..bars {
        out.push(sub_bass[i]);
        out.push(bass_b[i]);
        out.push(mid_b[i]);
        out.push(treble_b[i]);
        out.push(amp_b[i]);
        out.push(onset_b[i]);
    }
    Ok(out)
}

// ── Beat Grid Detection ───────────────────────────────────────────────────────

fn detect_bpm_onset(onset: &[f32], fps: usize) -> f32 {
    let n = onset.len();
    let min_lag = ((fps as f32 * 60.0 / 200.0) as usize).max(1);
    let max_lag = ((fps as f32 * 60.0 / 60.0) as usize).min(n.saturating_sub(1) / 4);
    if min_lag >= max_lag { return 120.0; }
    let mut best_lag = min_lag;
    let mut best_corr = f32::NEG_INFINITY;
    for lag in min_lag..=max_lag {
        let corr: f32 = onset.iter().zip(&onset[lag..]).map(|(&a, &b)| a * b).sum();
        if corr > best_corr { best_corr = corr; best_lag = lag; }
    }
    let raw_bpm = 60.0 * fps as f32 / best_lag as f32;
    let mut bpm = raw_bpm;
    while bpm < 60.0  { bpm *= 2.0; }
    while bpm > 180.0 { bpm /= 2.0; }
    (bpm * 2.0).round() / 2.0
}

fn gaussian_smooth_f32(arr: &[f32], sigma: f32) -> Vec<f32> {
    let n = arr.len();
    if n == 0 { return vec![]; }
    let rad = (sigma * 3.0).ceil() as usize;
    let inv2s2 = 1.0 / (2.0 * sigma * sigma);
    let mut out = vec![0.0f32; n];
    for i in 0..n {
        let mut sum = 0.0f32;
        let mut w   = 0.0f32;
        let lo = i.saturating_sub(rad);
        let hi = (i + rad).min(n - 1);
        for j in lo..=hi {
            let d = (i as i32 - j as i32) as f32;
            let wt = (-d * d * inv2s2).exp();
            sum += arr[j] * wt;
            w   += wt;
        }
        out[i] = if w > 1e-9 { sum / w } else { 0.0 };
    }
    out
}

#[tauri::command]
fn detect_beat_grid(path: String, hint_bpm: Option<f32>) -> Result<serde_json::Value, String> {
    let (samples, sr) = decode_pcm_with_sr(&path)
        .map_err(|e| format!("decode: {}", e))?;

    let fallback_bpm = hint_bpm.filter(|&b| b >= 20.0 && b <= 250.0).unwrap_or(120.0);

    if samples.len() < 4410 {
        return Ok(serde_json::json!({ "bpm": fallback_bpm, "phase_ms": 0.0 }));
    }

    // Onset strength envelope at 100 fps
    let fps: usize = 100;
    let hop = (sr as usize / fps).max(1);
    let frame_count = samples.len() / hop;

    let energy: Vec<f32> = (0..frame_count).map(|i| {
        let s = i * hop;
        let e = ((i + 1) * hop).min(samples.len());
        let sl = &samples[s..e];
        if sl.is_empty() { return 0.0f32; }
        (sl.iter().map(|&x| x * x).sum::<f32>() / sl.len() as f32).sqrt()
    }).collect();

    let mut onset = vec![0.0f32; frame_count];
    for i in 2..frame_count {
        onset[i] = (energy[i] - energy[i - 1]).max(0.0)
                 + (energy[i] - energy[i - 2]).max(0.0) * 0.5;
    }
    let max_onset = onset.iter().cloned().fold(1e-9f32, f32::max);
    if max_onset > 1e-9 { onset.iter_mut().for_each(|x| *x /= max_onset); }

    // BPM: use hint if provided, otherwise auto-detect
    let bpm = if let Some(h) = hint_bpm.filter(|&b| b >= 20.0 && b <= 250.0) {
        h
    } else {
        detect_bpm_onset(&onset, fps)
    };

    // Phase detection: find offset (within one beat period) that maximizes onset energy
    let period = (fps as f32 * 60.0 / bpm).round() as usize;
    if period == 0 {
        return Ok(serde_json::json!({ "bpm": bpm, "phase_ms": 0.0 }));
    }

    // Sum onset values at each possible phase, looking at the first 32 beats
    let search_end = (period * 32).min(frame_count);
    let mut phase_scores = vec![0.0f32; period];
    for i in 0..search_end {
        phase_scores[i % period] += onset[i];
    }

    let smoothed = gaussian_smooth_f32(&phase_scores, (period as f32 * 0.03).max(1.0));

    let best_phase = smoothed.iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| i)
        .unwrap_or(0);

    let phase_ms = (best_phase as f32 / fps as f32) * 1000.0;

    Ok(serde_json::json!({ "bpm": bpm, "phase_ms": phase_ms }))
}

#[tauri::command]
fn save_beat_grid(path: String, phase_ms: f32) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str())
        .map(|e| e.to_lowercase()).unwrap_or_default();
    if ext != "mp3" && ext != "aiff" && ext != "aif" { return Ok(()); }

    let saved_times = capture_mtime(&path);
    let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
    tag.remove_extended_text(Some("TAGWAVE_BEAT_PHASE"), None);
    tag.add_frame(id3::frame::ExtendedText {
        description: "TAGWAVE_BEAT_PHASE".to_string(),
        value: format!("{:.2}", phase_ms),
    });
    ensure_writable(&path);
    let result = tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string());
    restore_mtime(&path, saved_times);
    result
}

// ── Beat Anchors ──────────────────────────────────────────────────────────────

fn beat_anchor_sidecar_path(path: &Path) -> std::path::PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let hash = format!("{:x}", hasher.finalize())[..24].to_string();
    let home = home_dir().map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    std::path::PathBuf::from(home).join(".tagwave").join("cues").join(format!("{}_anchors.json", hash))
}

fn load_beat_anchor_sidecar(path: &Path) -> Option<Vec<BeatAnchor>> {
    let sp = beat_anchor_sidecar_path(path);
    fs::read(&sp).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

#[tauri::command]
fn save_beat_anchors(path: String, anchors: Vec<BeatAnchor>) -> Result<(), String> {
    let saved_times = capture_mtime(&path);
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if is_id3_format(&ext) {
        let mut tag = id3::Tag::read_from_path(p).unwrap_or_else(|_| id3::Tag::new());
        tag.remove_extended_text(Some("TAGWAVE_BEAT_ANCHORS"), None);
        if !anchors.is_empty() {
            let json = serde_json::to_string(&anchors).map_err(|e| e.to_string())?;
            tag.add_frame(id3::frame::ExtendedText {
                description: "TAGWAVE_BEAT_ANCHORS".to_string(),
                value: json,
            });
        }
        ensure_writable(&path);
        tag.write_to_path(p, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    } else {
        let sp = beat_anchor_sidecar_path(p);
        if let Some(parent) = sp.parent() { fs::create_dir_all(parent).ok(); }
        let json = serde_json::to_vec(&anchors).map_err(|e| e.to_string())?;
        fs::write(&sp, json).map_err(|e| e.to_string())?;
    }
    restore_mtime(&path, saved_times);
    Ok(())
}

#[tauri::command]
fn load_beat_anchors(path: String) -> Vec<BeatAnchor> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if is_id3_format(&ext) {
        if let Ok(tag) = id3::Tag::read_from_path(p) {
            if let Some(anchors) = tag.extended_texts()
                .find(|e| e.description == "TAGWAVE_BEAT_ANCHORS")
                .and_then(|e| serde_json::from_str::<Vec<BeatAnchor>>(&e.value).ok())
            {
                return anchors;
            }
        }
    }
    load_beat_anchor_sidecar(p).unwrap_or_default()
}

#[tauri::command]
fn analyze_structure_bands(path: String, bars: usize) -> Result<Vec<f32>, String> {
    if bars == 0 { return Ok(vec![]); }
    match decode_pcm_with_sr(&path) {
        Ok((samples, sr)) if samples.len() >= 2 => build_structure_bands(&samples, bars, sr),
        _ => Ok(vec![0.0f32; bars * 6]),
    }
}

// ── Filename Cleanup ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FilenameIssue {
    path: String,
    current: String,
    suggested: String,
    tags: Vec<String>,
}

fn strip_numeric_prefix(s: &str) -> Option<String> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { return None; }
    let rest = &s[digits.len()..];
    let rest = rest.trim_start_matches(|c: char| c == ' ' || c == '-' || c == '.' || c == '_');
    let rest = rest.trim_start();
    if rest.chars().next().map(|c| c.is_alphabetic()).unwrap_or(false) {
        Some(rest.to_string())
    } else {
        None
    }
}

// Substitui underscores de forma inteligente:
// _s / _re / _m / _t / _ll / _ve / _d após letra → apóstrofo (contração)
// demais underscores → espaço
fn replace_underscores_smart(s: &str) -> String {
    const SUFFIXES: &[&str] = &["re", "ve", "ll", "m", "t", "s", "d"];
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::with_capacity(s.len() + 4);
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '_' && i > 0 && chars[i - 1].is_alphabetic() {
            let rest: String = chars[i + 1..].iter().collect();
            let is_contraction = SUFFIXES.iter().any(|&suf| {
                if !rest.starts_with(suf) { return false; }
                let after = &rest[suf.len()..];
                after.is_empty() || !after.chars().next().map(|c| c.is_alphanumeric()).unwrap_or(false)
            });
            result.push(if is_contraction { '\'' } else { ' ' });
        } else {
            result.push(chars[i]);
        }
        i += 1;
    }
    result
}

fn clean_filename_str(name: &str) -> (String, Vec<String>) {
    let mut issues = vec![];
    let (stem, ext) = if let Some(dot) = name.rfind('.') {
        (&name[..dot], &name[dot..])
    } else {
        (name, "")
    };

    let mut s = stem.to_string();

    if s.contains('_') {
        s = replace_underscores_smart(&s);
        issues.push("underscores".to_string());
    }

    if s.contains('{') {
        let mut out = String::new();
        let mut depth = 0usize;
        for c in s.chars() {
            match c {
                '{' => depth += 1,
                '}' if depth > 0 => depth -= 1,
                _ if depth == 0 => out.push(c),
                _ => {}
            }
        }
        if out.trim() != s.trim() {
            s = out;
            issues.push("chaves { }".to_string());
        }
    }

    let trimmed = s.trim().to_string();
    if let Some(clean) = strip_numeric_prefix(&trimmed) {
        s = clean;
        issues.push("prefixo numérico".to_string());
    } else {
        s = trimmed;
    }

    while s.contains("  ") {
        s = s.replace("  ", " ");
    }
    s = s.trim().to_string();

    (format!("{}{}", s, ext), issues)
}

#[tauri::command]
fn analyze_filename_issues(paths: Vec<String>) -> Vec<FilenameIssue> {
    let my_gen = SCAN_GEN.load(Ordering::Relaxed);
    paths.par_iter().filter_map(|path| {
        // Aborta se um novo scan foi iniciado — evita starvation do thread pool
        if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return None; }
        let p = Path::new(path);
        let filename = p.file_name()?.to_string_lossy().to_string();
        let (suggested, tags) = clean_filename_str(&filename);
        if suggested == filename || tags.is_empty() { None }
        else {
            Some(FilenameIssue { path: path.clone(), current: filename, suggested, tags })
        }
    }).collect()
}

#[tauri::command]
fn apply_filename_fix(path: String, new_name: String) -> Result<String, String> {
    let p = Path::new(&path);
    let dir = p.parent().ok_or("sem diretório pai")?;
    let new_path = dir.join(&new_name);
    if new_path.as_path() == p { return Ok(path); }
    fs::rename(p, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

// ── Filename Paren Cleanup (Fase 2) ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ParenIssue {
    path: String,
    current_filename: String,
    suggested_filename: String,
    paren_content: String,
    suggested_content: String,
}

fn clean_inside_parens(s: &str) -> String {
    let mut result = String::new();
    let mut depth = 0usize;
    let mut inside = String::new();
    for c in s.chars() {
        match c {
            '(' => {
                depth += 1;
                if depth == 1 {
                    result.push('(');
                    inside.clear();
                } else {
                    inside.push(c);
                }
            }
            ')' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    // Clean inside content
                    let cleaned = inside
                        .replace('_', " ")
                        .replace('*', "")
                        .replace('{', "")
                        .replace('}', "");
                    let cleaned: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
                    result.push_str(&cleaned);
                    result.push(')');
                } else {
                    inside.push(c);
                }
            }
            _ => {
                if depth == 0 { result.push(c); } else { inside.push(c); }
            }
        }
    }
    result
}

fn paren_has_issues(s: &str) -> bool {
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            '_' | '*' | '{' | '}' if depth > 0 => return true,
            _ => {}
        }
    }
    false
}

#[tauri::command]
fn analyze_paren_content(paths: Vec<String>) -> Vec<ParenIssue> {
    let my_gen = SCAN_GEN.load(Ordering::Relaxed);
    paths.par_iter().filter_map(|path| {
        // Aborta se um novo scan foi iniciado
        if SCAN_GEN.load(Ordering::Relaxed) != my_gen { return None; }
        let p = Path::new(path);
        let filename = p.file_name()?.to_string_lossy().to_string();
        if !paren_has_issues(&filename) { return None; }
        let suggested = clean_inside_parens(&filename);
        if suggested == filename { return None; }
        // Extract first paren content for display
        let paren_start = filename.find('(')?;
        let paren_end = filename[paren_start..].find(')')? + paren_start;
        let paren_content = filename[paren_start..=paren_end].to_string();
        let suggested_content = clean_inside_parens(&paren_content);
        Some(ParenIssue {
            path: path.clone(),
            current_filename: filename,
            suggested_filename: suggested,
            paren_content,
            suggested_content,
        })
    }).collect()
}

#[tauri::command]
fn apply_paren_fix(path: String, new_name: String) -> Result<String, String> {
    let p = Path::new(&path);
    let dir = p.parent().ok_or("sem diretório pai")?;
    let new_path = dir.join(&new_name);
    if new_path.as_path() == p { return Ok(path); }
    fs::rename(p, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct DuplicateGroup {
    key: String,
    paths: Vec<String>,
}

#[tauri::command]
fn find_duplicates(tracks: Vec<Track>) -> Vec<DuplicateGroup> {
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for track in &tracks {
        let key = match (&track.title, &track.artist) {
            (Some(t), Some(a)) => {
                let t = t.trim().to_lowercase();
                let a = a.trim().to_lowercase();
                if t.is_empty() && a.is_empty() { continue; }
                format!("{}|||{}", t, a)
            }
            _ => {
                let stem = Path::new(&track.filename)
                    .file_stem().unwrap_or_default()
                    .to_string_lossy().to_lowercase();
                let (clean, _) = clean_filename_str(&stem);
                let clean = clean.trim().to_string();
                if clean.is_empty() { continue; }
                format!("file:{}", clean)
            }
        };
        groups.entry(key).or_default().push(track.path.clone());
    }
    let mut result: Vec<DuplicateGroup> = groups.into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .map(|(key, paths)| DuplicateGroup { key, paths })
        .collect();
    result.sort_by(|a, b| b.paths.len().cmp(&a.paths.len()));
    result
}

// ── Tag Normalization ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct NormalizeResult {
    path: String,
    changed: bool,
}

#[tauri::command]
fn normalize_tags(paths: Vec<String>) -> Vec<NormalizeResult> {
    let clean = |s: &str| -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") };
    paths.par_iter().map(|path| {
        let p = Path::new(path);
        let fmt = file_format(p);
        let changed = if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" {
            (|| -> Option<bool> {
                let mut tag = id3::Tag::read_from_path(path).ok()?;
                let mut dirty = false;
                if let Some(t) = tag.title()  { let c = clean(t); if c != t { tag.set_title(c); dirty = true; } }
                if let Some(a) = tag.artist() { let c = clean(a); if c != a { tag.set_artist(c); dirty = true; } }
                if let Some(a) = tag.album()  { let c = clean(a); if c != a { tag.set_album(c); dirty = true; } }
                if let Some(g) = tag.genre()  { let c = clean(g); if c != g { tag.set_genre(c); dirty = true; } }
                if dirty { ensure_writable(path); tag.write_to_path(path, id3::Version::Id3v24).ok()?; }
                Some(dirty)
            })().unwrap_or(false)
        } else {
            // FLAC, OGG, Opus, WAV, M4A: usa lofty
            (|| -> Option<bool> {
                let mut tagged = Probe::open(path).ok()?.read().ok()?;
                let tag = tagged.primary_tag_mut()?;
                let mut dirty = false;
                if let Some(t) = tag.title().map(|s| s.to_string()) {
                    let c = clean(&t); if c != t { tag.set_title(c.into()); dirty = true; }
                }
                if let Some(a) = tag.artist().map(|s| s.to_string()) {
                    let c = clean(&a); if c != a { tag.set_artist(c.into()); dirty = true; }
                }
                if let Some(a) = tag.album().map(|s| s.to_string()) {
                    let c = clean(&a); if c != a { tag.set_album(c.into()); dirty = true; }
                }
                if let Some(g) = tag.genre().map(|s| s.to_string()) {
                    let c = clean(&g); if c != g { tag.set_genre(c.into()); dirty = true; }
                }
                if dirty { ensure_writable(path); tagged.save_to_path(path, lofty::config::WriteOptions::default()).ok()?; }
                Some(dirty)
            })().unwrap_or(false)
        };
        NormalizeResult { path: path.clone(), changed }
    }).collect()
}

// ── Rekordbox XML Export ──────────────────────────────────────────────────────

#[tauri::command]
fn export_rekordbox(tracks: Vec<Track>, output_path: String, playlist_name: String) -> Result<usize, String> {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<DJ_PLAYLISTS Version=\"1.0.0\">\n");
    xml.push_str(&format!("  <PRODUCT Name=\"TagWave\" Version=\"{}\" Company=\"Bitran\"/>\n", env!("CARGO_PKG_VERSION")));
    xml.push_str("  <COLLECTION Entries=\"");
    xml.push_str(&tracks.len().to_string());
    xml.push_str("\">\n");

    for (i, track) in tracks.iter().enumerate() {
        let title   = xml_escape(track.title.as_deref().unwrap_or(&track.filename));
        let artist  = xml_escape(track.artist.as_deref().unwrap_or(""));
        let album   = xml_escape(track.album.as_deref().unwrap_or(""));
        let genre   = xml_escape(track.genre.as_deref().unwrap_or(""));
        let bpm     = track.bpm.as_deref().unwrap_or("0");
        let key     = xml_escape(track.key.as_deref().unwrap_or(""));
        let year    = track.year.map(|y| y.to_string()).unwrap_or_default();
        let dur_s   = track.duration_secs.map(|d| format!("{:.3}", d)).unwrap_or_default();
        let size    = track.file_size_bytes;
        // Rekordbox expects a proper file:// URI — encode special URL chars
        let encode_path = |p: &str| -> String {
            p.replace('%', "%25")
             .replace('#', "%23")
             .replace(' ', "%20")
             .replace('(', "%28")
             .replace(')', "%29")
             .replace('&', "%26")
             .replace('+', "%2B")
             .replace('?', "%3F")
        };
        let loc = if track.path.starts_with('/') {
            format!("file://{}", encode_path(&track.path))
        } else {
            format!("file:///{}", encode_path(&track.path.replace('\\', "/")))
        };

        xml.push_str(&format!(
            "    <TRACK TrackID=\"{}\" Name=\"{}\" Artist=\"{}\" Album=\"{}\" Genre=\"{}\" \
             TotalTime=\"{}\" AverageBpm=\"{}\" Tonality=\"{}\" Year=\"{}\" Size=\"{}\" \
             Location=\"{}\"/>\n",
            i + 1, title, artist, album, genre,
            dur_s, bpm, key, year, size, loc
        ));
    }

    xml.push_str("  </COLLECTION>\n");
    xml.push_str("  <PLAYLISTS>\n    <NODE Type=\"0\" Name=\"ROOT\" Count=\"1\">\n");
    xml.push_str(&format!("      <NODE Name=\"{}\" Type=\"1\" KeyType=\"0\" Entries=\"{}\">\n",
        xml_escape(&playlist_name), tracks.len()));
    for i in 0..tracks.len() {
        xml.push_str(&format!("        <TRACK Key=\"{}\"/>\n", i + 1));
    }
    xml.push_str("      </NODE>\n    </NODE>\n  </PLAYLISTS>\n</DJ_PLAYLISTS>\n");

    fs::write(&output_path, xml).map_err(|e| e.to_string())?;
    Ok(tracks.len())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('"', "&quot;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
}

// ── M3U Export ────────────────────────────────────────────────────────────────

#[tauri::command]
fn export_m3u(tracks: Vec<Track>, output_path: String) -> Result<usize, String> {
    let mut m3u = String::from("#EXTM3U\n");
    for track in &tracks {
        let dur = track.duration_secs.map(|d| d as i64).unwrap_or(-1);
        let name = match (&track.artist, &track.title) {
            (Some(a), Some(t)) => format!("{} - {}", a, t),
            (None, Some(t)) => t.clone(),
            _ => track.filename.clone(),
        };
        m3u.push_str(&format!("#EXTINF:{},{}\n{}\n", dur, name, track.path));
    }
    fs::write(&output_path, m3u).map_err(|e| e.to_string())?;
    Ok(tracks.len())
}

// ── CSV Export ────────────────────────────────────────────────────────────────

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[tauri::command]
fn export_csv(tracks: Vec<Track>, output_path: String) -> Result<usize, String> {
    let mut csv = String::from("Title,Artist,Album,Genre,Year,BPM,Key,Rating,Duration,Bitrate,Path\n");
    for track in &tracks {
        let title    = csv_escape(track.title.as_deref().unwrap_or(""));
        let artist   = csv_escape(track.artist.as_deref().unwrap_or(""));
        let album    = csv_escape(track.album.as_deref().unwrap_or(""));
        let genre    = csv_escape(track.genre.as_deref().unwrap_or(""));
        let year     = track.year.map(|y| y.to_string()).unwrap_or_default();
        let bpm      = track.bpm.as_deref().unwrap_or("").to_string();
        let key      = csv_escape(track.key.as_deref().unwrap_or(""));
        let rating   = track.rating.map(|r| r.to_string()).unwrap_or_default();
        let duration = track.duration_secs.map(|d| format!("{:.0}", d)).unwrap_or_default();
        let bitrate  = track.bitrate_kbps.map(|b| b.to_string()).unwrap_or_default();
        let path     = csv_escape(&track.path);
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{}\n",
            title, artist, album, genre, year, bpm, key, rating, duration, bitrate, path
        ));
    }
    fs::write(&output_path, "\u{FEFF}".to_string() + &csv).map_err(|e| e.to_string())?;
    Ok(tracks.len())
}

// ── Traktor NML Export ────────────────────────────────────────────────────────

#[tauri::command]
fn export_traktor_nml(tracks: Vec<Track>, output_path: String) -> Result<usize, String> {
    let mut nml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    nml.push_str("<NML VERSION=\"19\">\n");
    nml.push_str("  <HEAD COMPANY=\"Native Instruments GmbH\" PROGRAM=\"Traktor Pro 3\"/>\n");
    nml.push_str(&format!("  <COLLECTION ENTRIES=\"{}\">\n", tracks.len()));

    for track in &tracks {
        let path_obj = Path::new(&track.path);
        let filename = xml_escape(
            &path_obj.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default()
        );
        // Traktor format: /: + path segments joined with /:  ending with /:
        let dir_raw = path_obj.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let dir = if dir_raw.is_empty() {
            "/:".to_string()
        } else {
            format!("/:{}/:", dir_raw.trim_start_matches('/').replace('/', "/:"))
        };

        let title   = xml_escape(track.title.as_deref().unwrap_or(filename.as_str()));
        let artist  = xml_escape(track.artist.as_deref().unwrap_or(""));
        let album   = xml_escape(track.album.as_deref().unwrap_or(""));
        let genre   = xml_escape(track.genre.as_deref().unwrap_or(""));
        let key     = xml_escape(track.key.as_deref().unwrap_or(""));
        let bpm     = track.bpm.as_deref().and_then(|b| b.parse::<f64>().ok()).unwrap_or(0.0);
        let dur     = track.duration_secs.unwrap_or(0.0);
        let bitrate = track.bitrate_kbps.map(|b| b * 1000).unwrap_or(0);
        let rating  = track.rating.unwrap_or(0);
        let tn      = track.track_number.unwrap_or(0);

        nml.push_str(&format!(
            "    <ENTRY TITLE=\"{}\" ARTIST=\"{}\">\n\
             <LOCATION DIR=\"{}\" FILE=\"{}\" VOLUME=\"\" VOLUMEID=\"\"/>\n\
             <ALBUM TRACK=\"{}\" TITLE=\"{}\"/>\n\
             <INFO BITRATE=\"{}\" GENRE=\"{}\" RATING=\"{}\" PLAYTIME=\"{}\" PLAYTIME_FLOAT=\"{:.6}\" KEY=\"{}\"/>\n\
             <TEMPO BPM=\"{:.6}\" BPM_QUALITY=\"100\"/>\n\
             </ENTRY>\n",
            title, artist,
            dir, filename,
            tn, album,
            bitrate, genre, rating, dur as u32, dur, key,
            bpm
        ));
    }

    nml.push_str("  </COLLECTION>\n</NML>\n");
    fs::write(&output_path, nml).map_err(|e| e.to_string())?;
    Ok(tracks.len())
}

// ── HTTP Clients (reutilizados entre chamadas para evitar reconexão TLS) ─────

static ITUNES_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static COVER_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn itunes_client() -> &'static reqwest::Client {
    ITUNES_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default()
    })
}

fn cover_client() -> &'static reqwest::Client {
    COVER_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .unwrap_or_default()
    })
}

// ── Batch Enrichment (iTunes Search) ─────────────────────────────────────────

fn strip_version_info(title: &str) -> String {
    const KW: &[&str] = &[
        "extended", "radio", "club", "original", "dub", "instrumental",
        "remix", "mix", "edit", "version", "vocal", "acapella", "live",
        "acoustic", "reprise", "remaster", "feat.", "ft.",
    ];
    let lower = title.to_lowercase();

    // trailing (…) or […] starting with a version keyword
    for &open in &['(', '['] {
        if let Some(pos) = title.rfind(open) {
            let inner = &lower[pos + 1..];
            if KW.iter().any(|kw| inner.starts_with(kw)) {
                let trimmed = title[..pos].trim();
                if !trimmed.is_empty() { return trimmed.to_string(); }
            }
        }
    }

    // trailing " - keyword"
    if let Some(pos) = title.rfind(" - ") {
        let after = &lower[pos + 3..];
        if KW.iter().any(|kw| after.starts_with(kw)) {
            let trimmed = title[..pos].trim();
            if !trimmed.is_empty() { return trimmed.to_string(); }
        }
    }

    title.to_string()
}

fn tokens_overlap(a: &str, b: &str) -> f32 {
    let ta: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let tb: std::collections::HashSet<&str> = b.split_whitespace().collect();
    if ta.is_empty() || tb.is_empty() { return 0.0; }
    let common = ta.intersection(&tb).count() as f32;
    common / ta.len().min(tb.len()) as f32
}

async fn query_itunes(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    path: &str,
) -> Option<EnrichResult> {
    let term = if !artist.is_empty() {
        format!("{} {}", artist, title)
    } else {
        title.to_string()
    };
    let url = format!(
        "https://itunes.apple.com/search?term={}&media=music&limit=5&country=BR",
        urlencoding::encode(&term)
    );

    dlog!("[iTunes] Buscando: {:?}  |  arquivo: {}", term, path.split(|c| c == '/' || c == '\\').last().unwrap_or(path));

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => { dlog!("[iTunes] ERRO de rede: {}", e); return None; }
    };
    let status = resp.status();
    dlog!("[iTunes] HTTP {}", status);
    if !status.is_success() { return None; }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => { dlog!("[iTunes] ERRO parse JSON: {}", e); return None; }
    };
    let results = json["results"].as_array()?;
    dlog!("[iTunes] {} resultado(s) recebido(s)", results.len());

    for (i, r) in results.iter().enumerate() {
        dlog!("  [{}] \"{}\" — \"{}\"",
            i,
            r["trackName"].as_str().unwrap_or("?"),
            r["artistName"].as_str().unwrap_or("?"),
        );
    }

    // Encontra o resultado que melhor corresponde ao artista/título buscados.
    // Sem fallback para results.first() — aceitar resultados não confirmados causa
    // dados incorretos (ex.: Janet Jackson "Runaway" aplicado a faixas não relacionadas).
    let search_title  = title.to_lowercase();
    let search_artist = artist.to_lowercase();
    let r = results.iter().find(|r| {
        let returned_artist = r["artistName"].as_str().unwrap_or("").to_lowercase();
        let returned_title  = r["trackName"].as_str().unwrap_or("").to_lowercase();
        let artist_ok = search_artist.is_empty()
            || returned_artist.contains(&search_artist)
            || search_artist.contains(&returned_artist)
            || tokens_overlap(&returned_artist, &search_artist) >= 0.5;
        let title_ok  = returned_title.contains(&search_title)
            || search_title.contains(&returned_title)
            || tokens_overlap(&returned_title, &search_title) >= 0.5;
        artist_ok && title_ok
    });

    if r.is_none() {
        dlog!("[iTunes] Nenhum resultado passou no filtro de correspondência para \"{} - {}\"", artist, title);
    } else {
        dlog!("[iTunes] Match aceito: \"{}\" — \"{}\"",
            r.unwrap()["trackName"].as_str().unwrap_or("?"),
            r.unwrap()["artistName"].as_str().unwrap_or("?"),
        );
    }
    let r = r?;

    let genre = r["primaryGenreName"].as_str().map(|s| s.to_string());
    let album = r["collectionName"].as_str().map(|s| s.to_string());
    let year = r["releaseDate"].as_str()
        .and_then(|d| d.split('-').next())
        .and_then(|y| y.parse::<u32>().ok());
    let cover_url = r["artworkUrl100"].as_str()
        .map(|s| s.replace("100x100", "600x600"));
    Some(EnrichResult { path: path.to_string(), genre, album, year, cover_url })
}

#[derive(Debug, Serialize, Deserialize)]
struct EnrichRequest {
    path: String,
    title: Option<String>,
    artist: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EnrichResult {
    path: String,
    genre: Option<String>,
    album: Option<String>,
    year: Option<u32>,
    cover_url: Option<String>,
}

// Processa todas as faixas sequencialmente com delay controlado por Tokio (mais preciso que
// setTimeout JS) e emite eventos de progresso para o frontend atualizar o highlight em tempo real.
// Uma única invocação JS para N faixas — elimina o overhead de múltiplos round-trips IPC.
#[tauri::command]
async fn batch_enrich_all(
    tracks: Vec<EnrichRequest>,
    app: tauri::AppHandle,
) -> Vec<EnrichResult> {
    let client = itunes_client();
    let mut results = Vec::new();

    for (idx, t) in tracks.iter().enumerate() {
        dlog!("\n[Enrich] === Faixa {}/{} ===", idx + 1, tracks.len());
        dlog!("[Enrich] título: {:?}  artista: {:?}", t.title, t.artist);

        // Notifica JS ANTES do delay para o highlight aparecer imediatamente
        let _ = app.emit("enrich_track_start", serde_json::json!({
            "path": t.path, "idx": idx, "total": tracks.len()
        }));

        // 3,5 s entre chamadas — seguro para o rate-limit da Apple (~20 req/min)
        if idx > 0 {
            dlog!("[Enrich] Aguardando 3,5 s (rate-limit)…");
            tokio::time::sleep(std::time::Duration::from_millis(3500)).await;
        }

        let result = match &t.title {
            None => EnrichResult { path: t.path.clone(), genre: None, album: None, year: None, cover_url: None },
            Some(title) => {
                let artist = t.artist.as_deref().unwrap_or("");
                let hit = query_itunes(client, title, artist, &t.path).await;
                if let Some(h) = hit {
                    h
                } else {
                    let stripped = strip_version_info(title);
                    if !stripped.is_empty() && stripped.as_str() != title.as_str() {
                        query_itunes(client, &stripped, artist, &t.path).await
                            .unwrap_or_else(|| EnrichResult { path: t.path.clone(), genre: None, album: None, year: None, cover_url: None })
                    } else {
                        EnrichResult { path: t.path.clone(), genre: None, album: None, year: None, cover_url: None }
                    }
                }
            }
        };

        let found = result.genre.is_some() || result.album.is_some() || result.year.is_some();
        dlog!("[Enrich] Resultado: {} | gênero={:?} álbum={:?} ano={:?} capa={}",
            if found { "ENCONTRADO" } else { "NÃO ENCONTRADO" },
            result.genre, result.album, result.year,
            if result.cover_url.is_some() { "sim" } else { "não" }
        );
        let _ = app.emit("enrich_track_done", serde_json::json!({
            "path": t.path, "idx": idx + 1, "total": tracks.len(), "found": found
        }));

        results.push(result);
    }

    results
}

// Mantido para compatibilidade com chamadas legacy (não usado pelo batchEnrich principal)
#[tauri::command]
async fn enrich_single_itunes(path: String, title: Option<String>, artist: Option<String>) -> EnrichResult {
    let client = itunes_client();
    let (t, a) = match (&title, &artist) {
        (Some(ti), Some(a)) => (ti.as_str(), a.as_str()),
        (Some(ti), None)    => (ti.as_str(), ""),
        _ => return EnrichResult { path, genre: None, album: None, year: None, cover_url: None },
    };
    if let Some(hit) = query_itunes(client, t, a, &path).await { return hit; }
    let stripped = strip_version_info(t);
    if !stripped.is_empty() && stripped != t {
        if let Some(hit2) = query_itunes(client, &stripped, a, &path).await { return hit2; }
    }
    EnrichResult { path, genre: None, album: None, year: None, cover_url: None }
}

// ── DJ Software Detection & Playlist Export ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct DjSoftwareInfo {
    id: String,
    name: String,
    installed: bool,
}

#[tauri::command]
fn detect_dj_software() -> Vec<DjSoftwareInfo> {
    let candidates = dj_software_candidates();
    candidates.into_iter().map(|(id, name, paths)| {
        let installed = paths.iter().any(|p| Path::new(p).exists());
        DjSoftwareInfo { id, name, installed }
    }).collect()
}

fn dj_software_candidates() -> Vec<(String, String, Vec<String>)> {
    #[cfg(target_os = "macos")]
    {
        vec![
            ("serato".into(),    "Serato DJ Pro".into(),        vec![
                "/Applications/Serato DJ Pro.app".into(),
                "/Applications/Serato DJ Lite.app".into(),
            ]),
            ("rekordbox".into(), "rekordbox".into(),             vec![
                "/Applications/rekordbox.app".into(),
                "/Applications/rekordbox 6.app".into(),
                "/Applications/rekordbox 6/rekordbox.app".into(),
                "/Applications/rekordbox 7/rekordbox.app".into(),
                "/Applications/rekordbox 8/rekordbox.app".into(),
            ]),
            ("traktor".into(),   "Traktor Pro 3".into(),         vec![
                "/Applications/Traktor Pro 3.app".into(),
                "/Applications/Traktor Pro 2.app".into(),
                "/Applications/Traktor Pro.app".into(),
                "/Applications/Native Instruments/Traktor Pro 3.app".into(),
            ]),
            ("vdj".into(),       "Virtual DJ".into(),            vec![
                "/Applications/VirtualDJ.app".into(),
                "/Applications/VirtualDJ 2023.app".into(),
                "/Applications/VirtualDJ 2024.app".into(),
                "/Applications/VirtualDJ 2025.app".into(),
            ]),
            ("djay".into(),      "djay Pro (Algoriddim)".into(), vec![
                "/Applications/djay Pro.app".into(),
                "/Applications/djay Pro AI.app".into(),
                "/Applications/djay.app".into(),
            ]),
            ("engine_dj".into(), "Engine DJ".into(),             vec![
                "/Applications/Engine DJ.app".into(),
            ]),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        let pf  = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
        let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into());
        vec![
            ("serato".into(),    "Serato DJ Pro".into(),        vec![
                format!("{}\\Serato\\DJ Pro\\DJ Pro.exe",       pf),
                format!("{}\\Serato\\DJ Pro\\DJ Pro.exe",       pf86),
                format!("{}\\Serato\\DJ Lite\\DJ Lite.exe",     pf),
                format!("{}\\Serato\\DJ Lite\\DJ Lite.exe",     pf86),
            ]),
            ("rekordbox".into(), "rekordbox".into(),             vec![
                format!("{}\\Pioneer\\rekordbox\\rekordbox.exe",   pf),
                format!("{}\\Pioneer\\rekordbox\\rekordbox.exe",   pf86),
                format!("{}\\rekordbox\\rekordbox.exe",            pf),
                format!("{}\\rekordbox\\rekordbox.exe",            pf86),
            ]),
            ("traktor".into(),   "Traktor Pro 3".into(),         vec![
                format!("{}\\Native Instruments\\Traktor Pro 3\\Traktor.exe", pf),
                format!("{}\\Native Instruments\\Traktor Pro 3\\Traktor.exe", pf86),
            ]),
            ("vdj".into(),       "Virtual DJ".into(),            vec![
                format!("{}\\VirtualDJ\\VirtualDJ.exe", pf),
                format!("{}\\VirtualDJ\\VirtualDJ.exe", pf86),
            ]),
            ("djay".into(),      "djay Pro (Algoriddim)".into(), vec![
                // djay Pro via Microsoft Store — sem caminho fixo, marcar como não instalado
            ]),
            ("engine_dj".into(), "Engine DJ".into(),             vec![
                format!("{}\\Engine DJ\\Engine DJ.exe", pf),
                format!("{}\\Engine DJ\\Engine DJ.exe", pf86),
                format!("{}\\inMusic\\Engine DJ\\Engine DJ.exe", pf),
                format!("{}\\inMusic\\Engine DJ\\Engine DJ.exe", pf86),
            ]),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { vec![] }
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    // HOME = macOS/Linux; USERPROFILE = Windows
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .map_err(|_| "Home directory not found".to_string())
}

fn write_serato_crate(tracks: &[Track], path: &Path) -> Result<(), String> {
    let mut data: Vec<u8> = Vec::new();

    let encode_utf16be = |s: &str| -> Vec<u8> {
        s.encode_utf16().flat_map(|c| c.to_be_bytes()).collect()
    };

    let write_chunk = |data: &mut Vec<u8>, tag: &[u8; 4], payload: &[u8]| {
        data.extend_from_slice(tag);
        data.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        data.extend_from_slice(payload);
    };

    // vrsn chunk
    let version_bytes = encode_utf16be("1.0/Serato ScratchLive Crate");
    write_chunk(&mut data, b"vrsn", &version_bytes);

    // otrk chunk per track
    for track in tracks {
        // macOS: arquivos em /Volumes/Nome/... → "Nome/..." (Serato usa nome do volume diretamente)
        //        arquivos na raiz /Users/...   → "Macintosh HD/Users/..."
        // Windows: "C:/Users/..." (forward slashes, as-is)
        #[cfg(target_os = "macos")]
        let serato_path = if track.path.starts_with("/Volumes/") {
            // External volume: Serato stores as "Macintosh HD/Volumes/DriveName/..."
            format!("Macintosh HD{}", track.path)
        } else {
            // Boot disk: strip leading slash (Serato stores as "Users/..." not "/Users/...")
            track.path.trim_start_matches('/').to_string()
        };
        #[cfg(target_os = "windows")]
        let serato_path = track.path.replace('\\', "/");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let serato_path = track.path.clone();
        let path_bytes = encode_utf16be(&serato_path);

        let mut ptrk: Vec<u8> = Vec::new();
        write_chunk(&mut ptrk, b"ptrk", &path_bytes);

        write_chunk(&mut data, b"otrk", &ptrk);
    }

    fs::write(path, &data).map_err(|e| e.to_string())
}

fn write_traktor_nml(tracks: &[Track], path: &Path, playlist_name: &str) -> Result<(), String> {
    let to_traktor_dir = |full_path: &str| -> (String, String, String) {
        let p = std::path::Path::new(full_path);
        let filename = p.file_name().unwrap_or_default().to_str().unwrap_or("").to_string();
        let parent = p.parent().unwrap_or(std::path::Path::new("/"));

        #[cfg(target_os = "windows")]
        {
            // Windows: volume = drive letter (ex: "C:"), dir = /:<rest>/:
            let mut comps: Vec<&str> = parent.components()
                .filter_map(|c| match c {
                    std::path::Component::Normal(s) => s.to_str(),
                    _ => None,
                })
                .collect();
            // First component after stripping drive is the path parts
            let drive = parent.components()
                .find_map(|c| if let std::path::Component::Prefix(p) = c {
                    p.as_os_str().to_str().map(|s| s.trim_end_matches(':').to_string())
                } else { None })
                .unwrap_or_else(|| "C".to_string());
            let volume = format!("{}:", drive);
            // Remove drive component from comps if present
            if comps.first().map(|s| s.ends_with(':') || s.len() == 2).unwrap_or(false) {
                comps.remove(0);
            }
            let dir = format!("/:{}/:", comps.join("/:"));
            let key = format!("{}{}{}",  volume, dir, filename);
            (volume, dir, key)
        }

        #[cfg(not(target_os = "windows"))]
        {
            let components: Vec<&str> = parent.components()
                .filter_map(|c| match c {
                    std::path::Component::Normal(s) => s.to_str(),
                    _ => None,
                })
                .collect();
            let dir = format!("/:{}/:", components.join("/:"));
            let key = format!("Macintosh HD{}{}", dir, filename);
            ("Macintosh HD".to_string(), dir, key)
        }
    };

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<NML VERSION=\"18\">\n");
    xml.push_str("  <HEAD COMPANY=\"www.native-instruments.com\" PROGRAM=\"Traktor\"/>\n");
    xml.push_str("  <MUSICFOLDERS/>\n");
    xml.push_str(&format!("  <COLLECTION ENTRIES=\"{}\">\n", tracks.len()));

    for track in tracks {
        let title  = xml_escape(track.title.as_deref().unwrap_or(&track.filename));
        let artist = xml_escape(track.artist.as_deref().unwrap_or(""));
        let album  = xml_escape(track.album.as_deref().unwrap_or(""));
        let genre  = xml_escape(track.genre.as_deref().unwrap_or(""));
        let dur    = track.duration_secs.map(|d| d as u32).unwrap_or(0);
        let bpm    = track.bpm.as_deref().unwrap_or("0");
        let (volume, dir, _key) = to_traktor_dir(&track.path);
        let filename = xml_escape(&track.filename);

        xml.push_str(&format!(
            "    <ENTRY TITLE=\"{}\" ARTIST=\"{}\" ALBUM=\"{}\" GENRE=\"{}\" COMMENT=\"\">\n",
            title, artist, album, genre
        ));
        xml.push_str(&format!(
            "      <LOCATION DIR=\"{}\" FILE=\"{}\" VOLUME=\"{}\" VOLUMEID=\"\"/>\n",
            xml_escape(&dir), xml_escape(&filename), xml_escape(&volume)
        ));
        xml.push_str(&format!(
            "      <INFO BITRATE=\"{}\" PLAYTIME=\"{}\" BPM=\"{}\"/>\n",
            track.bitrate_kbps.unwrap_or(0) * 1000, dur, bpm
        ));
        xml.push_str("    </ENTRY>\n");
    }

    xml.push_str("  </COLLECTION>\n");
    xml.push_str("  <PLAYLISTS>\n");
    xml.push_str("    <NODE TYPE=\"FOLDER\" NAME=\"$ROOT\">\n");
    xml.push_str(&format!("      <SUBNODES COUNT=\"1\">\n"));
    xml.push_str(&format!("        <NODE TYPE=\"PLAYLIST\" NAME=\"{}\">\n", xml_escape(playlist_name)));
    xml.push_str(&format!("          <PLAYLIST ENTRIES=\"{}\" TYPE=\"LIST\" UUID=\"\">\n", tracks.len()));

    for track in tracks {
        let (_vol, _dir, key) = to_traktor_dir(&track.path);
        xml.push_str(&format!("            <ENTRY><PRIMARYKEY TYPE=\"TRACK\" KEY=\"{}\"/></ENTRY>\n", xml_escape(&key)));
    }

    xml.push_str("          </PLAYLIST>\n");
    xml.push_str("        </NODE>\n");
    xml.push_str("      </SUBNODES>\n");
    xml.push_str("    </NODE>\n");
    xml.push_str("  </PLAYLISTS>\n");
    xml.push_str("</NML>\n");

    fs::write(path, xml).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_playlist_to_dj(
    playlist_name: String,
    software_id: String,
    tracks: Vec<Track>,
) -> Result<String, String> {
    let home = home_dir()?;
    let safe_name: String = playlist_name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();

    match software_id.as_str() {
        "serato" => {
            #[cfg(target_os = "windows")]
            let dir = home.join("Documents").join("My Serato").join("Subcrates");
            #[cfg(not(target_os = "windows"))]
            let dir = home.join("Music").join("_Serato_").join("Subcrates");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.crate", safe_name));
            write_serato_crate(&tracks, &path)?;
            Ok(path.to_string_lossy().to_string())
        }
        "rekordbox" => {
            let dir = home.join("Documents").join("TagWave Playlists");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{} - Rekordbox.xml", safe_name));
            let output = path.to_string_lossy().to_string();
            export_rekordbox(tracks, output.clone(), playlist_name.clone())?;
            Ok(output)
        }
        "engine_dj" => {
            let dir = home.join("Documents").join("TagWave Playlists");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{} - Engine DJ.xml", safe_name));
            let output = path.to_string_lossy().to_string();
            export_rekordbox(tracks, output.clone(), playlist_name.clone())?;
            Ok(output)
        }
        "traktor" => {
            // Try Traktor's own playlists dir first, fallback to Documents
            let traktor_dirs = [
                home.join("Documents").join("Native Instruments").join("Traktor Pro 3"),
                home.join("Documents").join("Native Instruments").join("Traktor Pro 2"),
                home.join("Documents").join("TagWave Playlists"),
            ];
            let base = traktor_dirs.iter()
                .find(|d| d.exists())
                .unwrap_or(&traktor_dirs[2]);
            let dir = base.join("TagWave Playlists");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.nml", safe_name));
            write_traktor_nml(&tracks, &path, &playlist_name)?;
            Ok(path.to_string_lossy().to_string())
        }
        "vdj" => {
            let dir = home.join("Documents").join("VirtualDJ").join("Playlists");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.m3u", safe_name));
            export_m3u(tracks, path.to_string_lossy().to_string())?;
            Ok(path.to_string_lossy().to_string())
        }
        "djay" => {
            #[cfg(target_os = "windows")]
            let dir = home.join("Documents").join("djay").join("Playlists");
            #[cfg(not(target_os = "windows"))]
            let dir = home.join("Music").join("djay").join("Playlists");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.m3u", safe_name));
            export_m3u(tracks, path.to_string_lossy().to_string())?;
            Ok(path.to_string_lossy().to_string())
        }
        _ => Err(format!("Software desconhecido: {}", software_id)),
    }
}

#[tauri::command]
fn open_dj_app(software_id: String) -> Result<(), String> {
    let candidates = dj_software_candidates();
    let paths = candidates.iter()
        .find(|(id, _, _)| id == &software_id)
        .map(|(_, _, p)| p)
        .ok_or_else(|| format!("Software desconhecido: {}", software_id))?;

    let app_path = paths.iter()
        .find(|p| Path::new(p.as_str()).exists())
        .ok_or_else(|| "Software não encontrado ou não instalado".to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(app_path).spawn().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new(app_path).spawn().map_err(|e| e.to_string())?;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("Plataforma não suportada".to_string());

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// DJ SYNC — Rekordbox (SQLCipher) + Serato (.crate binary)
// Mesma abordagem do Lexicon DJ: acesso direto aos bancos, sem XML intermediário.
// ═══════════════════════════════════════════════════════════════════════════

/// Chave SQLCipher hardcoded do Rekordbox 6/7.
/// Idêntica em todas as instalações, sem dependência de máquina ou licença.
/// Fonte: https://github.com/liamcottle/pioneer-rekordbox-database-encryption
const RB_CIPHER_KEY: &str = "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RbCue {
    pub position_ms: i64,
    pub kind: i64,        // 0=memory cue, 1=hot cue, 4=loop
    pub hot_cue_number: i64, // 0-7 para hot cues; -1 para memory cues
    pub color_r: u8,
    pub color_g: u8,
    pub color_b: u8,
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RbTrack {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub bpm: Option<f64>,       // BPM real (RB armazena × 100 → dividido aqui)
    pub key: Option<i64>,       // não usado — mantido para compatibilidade
    pub key_name: Option<String>, // nome do tom: "Am", "F#m", "C", etc.
    pub rating: Option<u8>,     // 0-5 estrelas
    pub cues: Vec<RbCue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RbPlaylist {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub is_folder: bool,
    pub track_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RbLibrary {
    pub db_path: String,
    pub tracks: Vec<RbTrack>,
    pub playlists: Vec<RbPlaylist>,
    pub total_tracks: usize,
    pub total_cues: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SeratoCrate {
    pub name: String,
    pub path: String,
    pub track_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DjSyncStats {
    pub tracks_read: usize,
    pub tracks_matched: usize,
    pub cues_imported: usize,
    pub cues_exported: usize,
    pub playlists_synced: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DjDatabasePaths {
    pub rekordbox: Option<String>,
    pub serato: Option<String>,
    pub rekordbox_running: bool,
    pub serato_running: bool,
}

/// Abre o master.db do Rekordbox com a chave SQLCipher correta.
fn rb_open(db_path: &str) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Não foi possível abrir master.db: {}", e))?;
    // Chave como string simples (passphrase) — formato exato que o Rekordbox usa.
    // NÃO usar x'...' (hex literal) — pyrekordbox confirmou que a chave é passphrase.
    conn.execute_batch(&format!("PRAGMA key = '{}';", RB_CIPHER_KEY))
        .map_err(|e| format!("Falha na descriptografia do Rekordbox: {}", e))?;
    // Verifica se realmente conseguiu ler
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|e| format!("master.db inacessível (chave inválida?): {}", e))?;
    Ok(conn)
}

/// Converte rating interno do Rekordbox (0,51,102,153,204,255) para 0-5 estrelas.
fn rb_rating_to_stars(v: i64) -> u8 {
    match v { 51 => 1, 102 => 2, 153 => 3, 204 => 4, 255 => 5, _ => 0 }
}

/// Converte BPM interno do Rekordbox (armazenado × 100) para float.
fn rb_bpm(v: i64) -> f64 { v as f64 / 100.0 }

/// Descobre o caminho do master.db do Rekordbox na máquina atual.
fn find_rekordbox_db() -> Option<String> {
    let home = home_dir().ok()?.to_string_lossy().into_owned();
    let candidates = vec![
        format!("{}/Library/Pioneer/rekordbox/master.db", home),
        format!("{}/Documents/Pioneer/rekordbox/master.db", home),
        format!("{}/AppData/Roaming/Pioneer/rekordbox/master.db", home),
    ];
    candidates.into_iter().find(|p| Path::new(p).exists())
}

/// Descobre TODOS os diretórios _Serato_ na máquina (home + todos os volumes montados).
fn find_all_serato_dirs() -> Vec<String> {
    let mut dirs = Vec::new();

    // Locais padrão no home
    if let Ok(home) = home_dir() {
        let home = home.to_string_lossy().into_owned();
        for candidate in &[
            format!("{}/Music/_Serato_", home),
            format!("{}/Documents/Serato/_Serato_", home),
        ] {
            if Path::new(candidate).exists() {
                dirs.push(candidate.clone());
            }
        }
    }

    // Todos os volumes montados (macOS: /Volumes/*)
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            let serato = entry.path().join("_Serato_");
            if serato.exists() {
                dirs.push(serato.to_string_lossy().into_owned());
            }
        }
    }

    // Windows: drives de A a Z
    #[cfg(target_os = "windows")]
    for letter in b'A'..=b'Z' {
        let path = format!("{}:\\_Serato_", letter as char);
        if Path::new(&path).exists() {
            dirs.push(path);
        }
    }

    dirs.dedup();
    dirs
}

/// Descobre o caminho da pasta _Serato_ principal (primeiro encontrado).
fn find_serato_dir() -> Option<String> {
    find_all_serato_dirs().into_iter().next()
}

/// Verifica se um processo de software DJ está em execução.
fn is_process_running(name: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("pgrep")
            .arg("-x").arg(name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {}", name), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(name))
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { false }
}

/// Retorna os caminhos dos bancos de dados DJ detectados.
#[tauri::command]
fn detect_dj_databases() -> DjDatabasePaths {
    let serato_dirs = find_all_serato_dirs();
    DjDatabasePaths {
        rekordbox: find_rekordbox_db(),
        serato: if serato_dirs.is_empty() { None } else {
            Some(format!("{} local(is) encontrado(s)", serato_dirs.len()))
        },
        rekordbox_running: is_process_running("rekordbox"),
        serato_running: is_process_running("Serato DJ Pro"),
    }
}

/// Lê a biblioteca completa do Rekordbox: faixas + hot cues + playlists.
#[tauri::command]
fn read_rekordbox_library(db_path: Option<String>) -> Result<RbLibrary, String> {
    let path = db_path
        .or_else(find_rekordbox_db)
        .ok_or("master.db do Rekordbox não encontrado")?;

    let conn = rb_open(&path)?;

    // ── Faixas ──────────────────────────────────────────────────────────
    // Nomes reais confirmados no schema do Rekordbox 7:
    // KeyID → djmdKey.ScaleName, ArtistID → djmdArtist.Name, BPM × 100
    let mut stmt = conn.prepare(
        "SELECT c.ID, c.FolderPath, c.Title,
                a.Name AS ArtistName,
                c.BPM, k.ScaleName, c.Rating
         FROM djmdContent c
         LEFT JOIN djmdArtist a ON c.ArtistID = a.ID
         LEFT JOIN djmdKey k ON c.KeyID = k.ID
         WHERE c.FolderPath IS NOT NULL AND c.FolderPath != ''
         ORDER BY c.ID"
    ).map_err(|e| format!("Erro na query de faixas: {}", e))?;

    let mut tracks: Vec<RbTrack> = stmt.query_map([], |row| {
        let id: i64 = row.get::<_, String>(0).map(|s| s.parse::<i64>().unwrap_or(0))?;
        let path: String = row.get(1)?;
        let title: Option<String> = row.get(2)?;
        let artist: Option<String> = row.get(3)?;
        let bpm_raw: Option<i64> = row.get(4)?;
        let key_name: Option<String> = row.get(5)?;
        let rating_raw: Option<i64> = row.get(6)?;
        Ok(RbTrack {
            id,
            path,
            title,
            artist,
            bpm: bpm_raw.map(rb_bpm),
            key: None, // chave como texto abaixo
            rating: rating_raw.map(rb_rating_to_stars),
            cues: vec![],
            key_name,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    // ── Hot cues + memory cues ───────────────────────────────────────────
    // Color é um INTEGER único no RB7 (não RGB separados); -1 = sem cor.
    // Número do hot cue é derivado da ordem (Kind=1 → hot cue; Kind=0 → memory).
    let mut cue_stmt = conn.prepare(
        "SELECT ContentID, InMsec, Kind, Color, Comment
         FROM djmdCue
         WHERE rb_local_deleted = 0 OR rb_local_deleted IS NULL
         ORDER BY ContentID, InMsec"
    ).map_err(|e| format!("Erro na query de cues: {}", e))?;

    // Mapeia ContentID (string) → Vec<RbCue>
    let mut cue_map: std::collections::HashMap<String, Vec<RbCue>> = std::collections::HashMap::new();
    let _ = cue_stmt.query_map([], |row| {
        let content_id: String = row.get(0)?;
        let pos_ms: i64 = row.get(1)?;
        let kind: i64 = row.get(2)?;
        let _color_int: Option<i64> = row.get(3)?;
        let comment: Option<String> = row.get(4)?;
        Ok((content_id, RbCue {
            position_ms: pos_ms,
            kind,
            hot_cue_number: -1, // será atribuído por índice ao montar o track
            color_r: 217,
            color_g: 83,
            color_b: 64,
            comment: comment.unwrap_or_default(),
        }))
    }).map(|rows| {
        for row in rows.flatten() {
            cue_map.entry(row.0).or_default().push(row.1);
        }
    });

    // Numerar hot cues sequencialmente por faixa
    for cues in cue_map.values_mut() {
        let mut hot_idx: i64 = 0;
        for cue in cues.iter_mut() {
            if cue.kind == 1 { cue.hot_cue_number = hot_idx; hot_idx += 1; }
        }
    }

    let total_cues: usize = cue_map.values().map(|v| v.len()).sum();
    for track in &mut tracks {
        let key = track.id.to_string();
        if let Some(cues) = cue_map.remove(&key) {
            track.cues = cues;
        }
    }

    // ── Playlists ────────────────────────────────────────────────────────
    // Rekordbox 7: tabela djmdPlaylist, Attribute=1 indica pasta, ParentID='root'
    let mut pl_stmt = conn.prepare(
        "SELECT ID, Name, ParentID, Attribute FROM djmdPlaylist
         WHERE (rb_local_deleted = 0 OR rb_local_deleted IS NULL)
         ORDER BY Seq"
    ).map_err(|e| format!("Erro na query de playlists: {}", e))?;

    let mut playlists: Vec<RbPlaylist> = pl_stmt.query_map([], |row| {
        let id_str: String = row.get(0)?;
        let id = id_str.parse::<i64>().unwrap_or(0);
        let name: String = row.get(1)?;
        let parent_raw: Option<String> = row.get(2)?;
        let parent_id: Option<i64> = parent_raw
            .filter(|s| s != "root")
            .and_then(|s| s.parse::<i64>().ok());
        let attr: Option<i64> = row.get(3)?;
        let is_folder = attr.unwrap_or(0) == 1;
        Ok(RbPlaylist { id, name, parent_id, is_folder, track_ids: vec![] })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    // Faixas por playlist — tabela real: djmdSongPlaylist
    let mut ps_stmt = conn.prepare(
        "SELECT PlaylistID, ContentID FROM djmdSongPlaylist
         WHERE (rb_local_deleted = 0 OR rb_local_deleted IS NULL)
         ORDER BY TrackNo"
    ).map_err(|e| format!("Erro na query de playlist songs: {}", e))?;

    let mut pl_tracks: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    let _ = ps_stmt.query_map([], |row| {
        let pl_id: String = row.get(0)?;
        let content_id: String = row.get(1)?;
        Ok((pl_id.parse::<i64>().unwrap_or(0), content_id.parse::<i64>().unwrap_or(0)))
    }).map(|rows| {
        for row in rows.flatten() {
            pl_tracks.entry(row.0).or_default().push(row.1);
        }
    });

    for pl in &mut playlists {
        if let Some(ids) = pl_tracks.remove(&pl.id) {
            pl.track_ids = ids;
        }
    }

    let total = tracks.len();
    Ok(RbLibrary { db_path: path, tracks, playlists, total_tracks: total, total_cues })
}

/// Importa hot cues do Rekordbox para as faixas do TagWave (match por caminho do arquivo).
/// Salva os cues diretamente no arquivo de áudio (Serato Markers2 — ambos softwares leem).
#[tauri::command]
fn import_cues_from_rekordbox(
    db_path: Option<String>,
    tagwave_track_paths: Vec<String>,
) -> Result<DjSyncStats, String> {
    let path = db_path.or_else(find_rekordbox_db)
        .ok_or("master.db não encontrado")?;
    let lib = read_rekordbox_library(Some(path))?;

    // Índice por caminho normalizado
    let tw_set: std::collections::HashSet<String> = tagwave_track_paths
        .iter().map(|p| p.to_lowercase()).collect();

    let mut matched = 0usize;
    let mut cues_imported = 0usize;

    for rb_track in &lib.tracks {
        if rb_track.cues.is_empty() { continue; }
        if !tw_set.contains(&rb_track.path.to_lowercase()) { continue; }
        matched += 1;

        // Converte RbCue → CuePoint do TagWave e salva no arquivo
        let cues: Vec<CuePoint> = rb_track.cues.iter().enumerate().map(|(i, c)| {
            let color = format!("#{:02X}{:02X}{:02X}", c.color_r, c.color_g, c.color_b);
            CuePoint {
                index: if c.hot_cue_number >= 0 { c.hot_cue_number as u8 } else { (i % 8) as u8 },
                position_ms: c.position_ms as u32,
                label: c.comment.clone(),
                color,
            }
        }).collect();

        // Reutiliza o comando save_cue_points existente
        if let Err(e) = save_cue_points(rb_track.path.clone(), cues.clone()) {
            dlog!("[DJ Sync] save_cue_points failed for {}: {}", rb_track.path, e);
        } else {
            cues_imported += cues.len();
        }
    }

    Ok(DjSyncStats {
        tracks_read: lib.total_tracks,
        tracks_matched: matched,
        cues_imported,
        cues_exported: 0,
        playlists_synced: 0,
    })
}

/// Exporta hot cues do TagWave para o master.db do Rekordbox.
/// ⚠️  Rekordbox DEVE estar fechado — escrita com RB aberto corrompe o banco.
#[tauri::command]
fn export_cues_to_rekordbox(
    db_path: Option<String>,
    tracks_with_cues: Vec<TrackCueExport>,
) -> Result<DjSyncStats, String> {
    let path = db_path.or_else(find_rekordbox_db)
        .ok_or("master.db não encontrado")?;

    if is_process_running("rekordbox") {
        return Err("Feche o Rekordbox antes de sincronizar. Escrita com o app aberto pode corromper o banco.".into());
    }

    // Backup antes de qualquer escrita
    let backup = format!("{}.tagwave_backup", path);
    if !Path::new(&backup).exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("Backup falhou: {}", e))?;
    }

    let conn = rb_open(&path)?;

    // Mapeia FolderPath → ContentID
    let mut path_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT ID, FolderPath FROM djmdContent WHERE FolderPath IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let _ = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let p: String = row.get(1)?;
            Ok((p, id))
        }).map(|rows| {
            for row in rows.flatten() { path_map.insert(row.0.to_lowercase(), row.1); }
        });
    }

    let mut matched = 0usize;
    let mut exported = 0usize;

    for entry in &tracks_with_cues {
        let content_id = match path_map.get(&entry.path.to_lowercase()) {
            Some(id) => *id,
            None => continue,
        };
        matched += 1;

        // Remove cues antigas desta faixa e insere as novas
        conn.execute("DELETE FROM djmdCue WHERE ContentID = ?", [content_id])
            .map_err(|e| format!("DELETE cues: {}", e))?;

        for cue in &entry.cues {
            let kind: i64 = if cue.index < 8 { 1 } else { 0 }; // hot cue ou memory
            let number: i64 = if kind == 1 { cue.index as i64 } else { -1 };
            // Converte cor hex → RGB
            let (r, g, b) = parse_hex_color(&cue.color);
            conn.execute(
                "INSERT INTO djmdCue (ContentID, InMsec, Kind, Number, ColorRed, ColorGreen, ColorBlue, Comment, UUID)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, lower(hex(randomblob(16))))",
                rusqlite::params![content_id, cue.position_ms as i64, kind, number,
                    r as i64, g as i64, b as i64, cue.label]
            ).map_err(|e| format!("INSERT cue: {}", e))?;
            exported += 1;
        }
    }

    Ok(DjSyncStats {
        tracks_read: tracks_with_cues.len(),
        tracks_matched: matched,
        cues_imported: 0,
        cues_exported: exported,
        playlists_synced: 0,
    })
}

/// Exporta playlists do TagWave para o Rekordbox (cria/atualiza no master.db).
#[tauri::command]
fn export_playlists_to_rekordbox(
    db_path: Option<String>,
    playlists: Vec<PlaylistExport>,
) -> Result<DjSyncStats, String> {
    let path = db_path.or_else(find_rekordbox_db)
        .ok_or("master.db não encontrado")?;

    if is_process_running("rekordbox") {
        return Err("Feche o Rekordbox antes de sincronizar.".into());
    }

    let backup = format!("{}.tagwave_backup", path);
    if !Path::new(&backup).exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("Backup: {}", e))?;
    }

    let conn = rb_open(&path)?;

    // Mapeia FolderPath → ContentID
    let mut path_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT ID, FolderPath FROM djmdContent WHERE FolderPath IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let _ = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let p: String = row.get(1)?;
            Ok((p, id))
        }).map(|rows| { for row in rows.flatten() { path_map.insert(row.0.to_lowercase(), row.1); } });
    }

    let mut synced = 0usize;

    for pl in &playlists {
        // Upsert playlist
        conn.execute(
            "INSERT OR IGNORE INTO djmdPlaylist (Name, IsFolder, ParentID, Seq, UUID)
             VALUES (?1, 0, NULL, 0, lower(hex(randomblob(16))))",
            rusqlite::params![pl.name]
        ).map_err(|e| format!("INSERT playlist: {}", e))?;

        let pl_id: i64 = conn.query_row(
            "SELECT ID FROM djmdPlaylist WHERE Name = ?1 AND IsFolder = 0 LIMIT 1",
            rusqlite::params![pl.name],
            |row| row.get(0)
        ).map_err(|e| format!("SELECT playlist ID: {}", e))?;

        // Remove faixas antigas e reinsere
        conn.execute("DELETE FROM djmdPlaylistSong WHERE PlaylistID = ?", [pl_id])
            .map_err(|e| format!("DELETE playlist songs: {}", e))?;

        for (i, track_path) in pl.track_paths.iter().enumerate() {
            if let Some(&content_id) = path_map.get(&track_path.to_lowercase()) {
                conn.execute(
                    "INSERT INTO djmdPlaylistSong (PlaylistID, ContentID, TrackNo, UUID)
                     VALUES (?1, ?2, ?3, lower(hex(randomblob(16))))",
                    rusqlite::params![pl_id, content_id, i as i64 + 1]
                ).map_err(|e| format!("INSERT song: {}", e))?;
            }
        }
        synced += 1;
    }

    Ok(DjSyncStats {
        tracks_read: playlists.len(),
        tracks_matched: synced,
        cues_imported: 0,
        cues_exported: 0,
        playlists_synced: synced,
    })
}

/// Estrutura para exportar faixas com cues para o Rekordbox.
#[derive(Debug, Serialize, Deserialize)]
pub struct TrackCueExport {
    pub path: String,
    pub cues: Vec<CuePoint>,
}

/// Estrutura para exportar playlists para o Rekordbox.
#[derive(Debug, Serialize, Deserialize)]
pub struct PlaylistExport {
    pub name: String,
    pub track_paths: Vec<String>,
}

fn parse_hex_color(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&h.get(0..2).unwrap_or("D9"), 16).unwrap_or(217);
    let g = u8::from_str_radix(&h.get(2..4).unwrap_or("53"), 16).unwrap_or(83);
    let b = u8::from_str_radix(&h.get(4..6).unwrap_or("40"), 16).unwrap_or(64);
    (r, g, b)
}

// ── Serato — leitura de crates (.crate binary format) ─────────────────────

/// Lê todos os crates do Serato de TODOS os drives onde _Serato_ existe.
#[tauri::command]
fn read_serato_crates() -> Result<Vec<SeratoCrate>, String> {
    let serato_dirs = find_all_serato_dirs();
    if serato_dirs.is_empty() {
        return Err("Pasta _Serato_ não encontrada em nenhum drive".into());
    }

    let mut crates: Vec<SeratoCrate> = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    for serato_dir in &serato_dirs {
        let subcrates_dir = format!("{}/Subcrates", serato_dir);
        if !Path::new(&subcrates_dir).exists() { continue; }

        for entry in WalkDir::new(&subcrates_dir).max_depth(5).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("crate") { continue; }

            // Nome do crate: substituir %% por / para refletir hierarquia Serato
            let raw_name = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unnamed");
            let name = raw_name.replace("%%", " / ");

            // Não duplicar crates com mesmo nome de drives diferentes
            if seen_names.contains(&name) { continue; }
            seen_names.insert(name.clone());

            let data = match std::fs::read(path) {
                Ok(d) => d,
                Err(_) => continue,
            };

            let track_paths = parse_serato_crate_file(&data);
            crates.push(SeratoCrate {
                name,
                path: path.to_string_lossy().into_owned(),
                track_paths,
            });
        }
    }

    // Ordenar por nome
    crates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(crates)
}

/// Parser do formato binário .crate do Serato.
/// Formato: sequência de tags TLV (4 bytes tipo + 4 bytes big-endian len + N bytes data).
fn parse_serato_crate_file(data: &[u8]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut pos = 0usize;

    while pos + 8 <= data.len() {
        let tag = &data[pos..pos + 4];
        let len = u32::from_be_bytes([data[pos+4], data[pos+5], data[pos+6], data[pos+7]]) as usize;
        pos += 8;
        if pos + len > data.len() { break; }
        let content = &data[pos..pos + len];

        if tag == b"otrk" {
            if let Some(p) = parse_ptrk(content) {
                paths.push(p);
            }
        }
        pos += len;
    }
    paths
}

fn parse_ptrk(data: &[u8]) -> Option<String> {
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let tag = &data[pos..pos + 4];
        let len = u32::from_be_bytes([data[pos+4], data[pos+5], data[pos+6], data[pos+7]]) as usize;
        pos += 8;
        if pos + len > data.len() { break; }
        if tag == b"ptrk" {
            let path_bytes = &data[pos..pos + len];
            let shorts: Vec<u16> = path_bytes.chunks(2)
                .filter_map(|c| if c.len() == 2 { Some(u16::from_be_bytes([c[0], c[1]])) } else { None })
                .collect();
            return Some(String::from_utf16_lossy(&shorts));
        }
        pos += len;
    }
    None
}

/// Importa crates do Serato como playlists do TagWave.
/// Retorna lista de playlists para criar no frontend.
#[tauri::command]
fn import_serato_crates_as_playlists() -> Result<Vec<SeratoCrate>, String> {
    read_serato_crates()
}

// ── Restaurar backup do Rekordbox ─────────────────────────────────────────

/// Restaura o backup do master.db criado antes da última sincronização.
#[tauri::command]
fn restore_rekordbox_backup(db_path: Option<String>) -> Result<(), String> {
    let path = db_path.or_else(find_rekordbox_db)
        .ok_or("master.db não encontrado")?;
    let backup = format!("{}.tagwave_backup", path);

    if !Path::new(&backup).exists() {
        return Err("Nenhum backup disponível".into());
    }
    if is_process_running("rekordbox") {
        return Err("Feche o Rekordbox antes de restaurar o backup.".into());
    }
    std::fs::copy(&backup, &path).map_err(|e| format!("Restauração falhou: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct RenameResult {
    pub old_path: String,
    pub new_path: String,
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string()
}

#[tauri::command]
fn rename_from_tags(paths: Vec<String>) -> Vec<RenameResult> {
    let mut results = Vec::new();
    for path in &paths {
        let p = Path::new(path);
        let ext = match p.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };
        let parent = match p.parent() { Some(d) => d, None => continue };

        // Lê título e artista dos metadados
        let (title, artist) = if ext == "mp3" || ext == "aiff" || ext == "aif" {
            let tag = id3::Tag::read_from_path(path).ok();
            (
                tag.as_ref().and_then(|t| t.title()).map(|s| s.to_string()),
                tag.as_ref().and_then(|t| t.artist()).map(|s| s.to_string()),
            )
        } else {
            match Probe::open(path).and_then(|p| p.read()) {
                Ok(tagged) => {
                    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
                    (
                        tag.and_then(|t| t.title()).map(|s| s.to_string()),
                        tag.and_then(|t| t.artist()).map(|s| s.to_string()),
                    )
                }
                Err(_) => continue,
            }
        };

        let title = match title.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(t) => sanitize_filename(t),
            None => continue, // sem título: pula
        };
        let stem = match artist.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(a) => format!("{} - {}", sanitize_filename(a), title),
            None => title,
        };

        let new_name = format!("{}.{}", stem, ext);
        let new_path = parent.join(&new_name);

        if new_path == p { continue; } // já tem o nome correto
        if new_path.exists() { continue; } // conflito: pula

        ensure_writable(path);
        if fs::rename(path, &new_path).is_ok() {
            results.push(RenameResult {
                old_path: path.clone(),
                new_path: new_path.to_string_lossy().into_owned(),
            });
        }
    }
    results
}

#[tauri::command]
fn save_cover_batch_from_file(paths: Vec<String>, image_path: String) -> Result<u32, String> {
    let cover_data = fs::read(&image_path).map_err(|e| e.to_string())?;
    let is_png = image_path.to_lowercase().ends_with(".png");
    let mut ok: u32 = 0;
    for path in &paths {
        let fmt = file_format(Path::new(path));
        let result = if fmt == "MP3" || fmt == "AIFF" || fmt == "AIF" || fmt == "WAV" {
            let mime = if is_png { "image/png".to_string() } else { "image/jpeg".to_string() };
            let mut tag = id3::Tag::read_from_path(path).unwrap_or_else(|_| id3::Tag::new());
            tag.remove("APIC");
            tag.add_frame(Picture {
                mime_type: mime,
                picture_type: PictureType::CoverFront,
                description: String::new(),
                data: cover_data.clone(),
            });
            ensure_writable(path);
            tag.write_to_path(path, id3::Version::Id3v24).map_err(|e| e.to_string())
        } else {
            let lofty_mime = if is_png { LoftyMime::Png } else { LoftyMime::Jpeg };
            match Probe::open(path).and_then(|p| p.read()) {
                Ok(mut tagged) => {
                    let has_primary = tagged.primary_tag().is_some();
                    let tag_opt = if has_primary {
                        tagged.primary_tag_mut()
                    } else {
                        tagged.first_tag_mut()
                    };
                    if let Some(tag) = tag_opt {
                        tag.remove_picture_type(LoftyPicType::CoverFront);
                        tag.push_picture(LoftyPic::new_unchecked(LoftyPicType::CoverFront, Some(lofty_mime), None, cover_data.clone()));
                        ensure_writable(path);
                        tagged.save_to_path(path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())
                    } else { Err("sem tag".into()) }
                }
                Err(e) => Err(e.to_string()),
            }
        };
        if result.is_ok() { ok += 1; }
    }
    Ok(ok)
}

#[tauri::command]
async fn download_update(url: String, dest: String) -> Result<String, String> {
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path.replace('/', "\\")])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Cache ─────────────────────────────────────────────────────────────────────

// Encerra o processo imediatamente — usado pelo handler onCloseRequested
// após salvar cache, para evitar o loop close→onCloseRequested→close.
#[tauri::command]
fn quit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn save_cache(app: tauri::AppHandle, tracks: Vec<Track>, last_folder: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cache = CacheData { tracks, last_folder };
    let json = serde_json::to_string(&cache).map_err(|e| e.to_string())?;
    fs::write(dir.join("cache.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_cache(app: tauri::AppHandle) -> Result<Option<CacheData>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("cache.json");
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cache: CacheData = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(cache))
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Retorna paths de arquivos de áudio na pasta que NÃO estão em `known_paths`.
#[tauri::command]
fn find_new_files(folder: String, known_paths: Vec<String>) -> Vec<String> {
    let known: std::collections::HashSet<String> = known_paths.into_iter().collect();
    WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if !e.file_type().is_file() { return false; }
            // Ignora resource forks do macOS (._arquivo) e arquivos ocultos
            let fname = e.file_name().to_string_lossy();
            if fname.starts_with("._") || fname.starts_with('.') { return false; }
            e.path().extension()
                .map(|ext| AUDIO_EXTENSIONS.iter().any(|&a| ext.eq_ignore_ascii_case(a)))
                .unwrap_or(false)
        })
        .map(|e| e.path().to_string_lossy().to_string())
        .filter(|p| !known.contains(p))
        .collect()
}

/// Escaneia metadados de uma lista específica de paths (sem progress event).
#[tauri::command]
fn scan_specific_files(paths: Vec<String>) -> Vec<Track> {
    paths.par_iter()
        .filter_map(|p| read_track(Path::new(p)))
        .collect()
}

// ── Licenciamento (LemonSqueezy) ─────────────────────────────────────────────

// Em debug (dev/beta) aceita qualquer chave. Em release, valida contra o LS.
#[cfg(debug_assertions)]
const LICENSING_ENABLED: bool = false;
#[cfg(not(debug_assertions))]
const LICENSING_ENABLED: bool = true;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct LicenseFile {
    key:              String,
    instance_id:      String,
    email:            String,
    activated_at:     String,
    #[serde(default)]
    last_validated:   String,
    #[serde(default)]
    fingerprint:      String,
}

#[derive(Serialize, Clone, Debug)]
struct LicenseStatus {
    valid:       bool,
    email:       String,
    instance_id: String,
    error:       Option<String>,
}

fn license_file_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("license.json"))
}

fn machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "TagWave".to_string())
}

/// Hash determinístico da máquina — identifica o dispositivo sem armazenar PII.
fn machine_fingerprint() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let hostname = machine_name();
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());
    let mut h = DefaultHasher::new();
    format!("tw:{}:{}", hostname, username).hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Ativa uma chave de licença. Quando LICENSING_ENABLED = false, aceita qualquer
/// chave com ≥ 10 caracteres e salva localmente (modo beta/dev).
#[tauri::command]
async fn activate_license_key(
    app: tauri::AppHandle,
    key: String,
) -> Result<LicenseStatus, String> {
    let key = key.trim().to_string();
    if key.len() < 10 {
        return Err("Chave muito curta".to_string());
    }

    let fp = machine_fingerprint();

    if !LICENSING_ENABLED {
        let info = LicenseFile {
            key:            key.clone(),
            instance_id:    "dev-instance".to_string(),
            email:          "beta@tagwave.app".to_string(),
            activated_at:   chrono::Utc::now().to_rfc3339(),
            last_validated: chrono::Utc::now().to_rfc3339(),
            fingerprint:    fp,
        };
        save_license_file(&app, &info);
        return Ok(LicenseStatus {
            valid: true,
            email: info.email,
            instance_id: info.instance_id,
            error: None,
        });
    }

    // Chamada real ao LemonSqueezy
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post("https://api.lemonsqueezy.com/v1/licenses/activate")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "license_key":   key,
            "instance_name": format!("TagWave/{} on {}", fp, machine_name()),
        }))
        .send()
        .await
        .map_err(|e| format!("Erro de rede: {}", e))?;

    let http_ok = res.status().is_success();
    let body: serde_json::Value = res.json().await
        .map_err(|e| format!("Resposta inválida: {}", e))?;

    if !http_ok || !body["activated"].as_bool().unwrap_or(false) {
        return Err(
            body["error"].as_str().unwrap_or("Chave inválida ou já utilizada").to_string()
        );
    }

    let instance_id = body["instance"]["id"].as_str().unwrap_or("").to_string();
    let email       = body["license_key"]["customer_email"].as_str().unwrap_or("").to_string();
    let now         = chrono::Utc::now().to_rfc3339();

    let info = LicenseFile {
        key:            key.clone(),
        instance_id:    instance_id.clone(),
        email:          email.clone(),
        activated_at:   now.clone(),
        last_validated: now,
        fingerprint:    fp,
    };
    save_license_file(&app, &info);

    Ok(LicenseStatus { valid: true, email, instance_id, error: None })
}

/// Verifica se há uma licença ativa salva localmente.
/// Quando LICENSING_ENABLED = true, revalida com o servidor.
#[tauri::command]
async fn check_license_status(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    let path = license_file_path(&app).ok_or("Config dir indisponível")?;
    if !path.exists() {
        return Err("Sem licença".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let info: LicenseFile = serde_json::from_str(&content).map_err(|_| "Arquivo de licença corrompido")?;

    if !LICENSING_ENABLED {
        return Ok(LicenseStatus {
            valid: true,
            email: info.email,
            instance_id: info.instance_id,
            error: None,
        });
    }

    // Revalidação periódica: só chama o servidor se passaram > 7 dias
    let needs_revalidation = {
        let last = if info.last_validated.is_empty() { &info.activated_at } else { &info.last_validated };
        chrono::DateTime::parse_from_rfc3339(last)
            .map(|dt| chrono::Utc::now().signed_duration_since(dt).num_days() >= 7)
            .unwrap_or(true)
    };

    if !needs_revalidation {
        return Ok(LicenseStatus {
            valid: true,
            email: info.email,
            instance_id: info.instance_id,
            error: None,
        });
    }

    // Revalidação online
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post("https://api.lemonsqueezy.com/v1/licenses/validate")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "license_key": info.key,
            "instance_id": info.instance_id,
        }))
        .send()
        .await
        .map_err(|_| "Sem conexão — usando licença em cache")?;

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    if !body["valid"].as_bool().unwrap_or(false) {
        let _ = fs::remove_file(&path);
        return Err(body["error"].as_str().unwrap_or("Licença revogada").to_string());
    }

    // Atualiza timestamp de última validação
    let mut updated = info;
    updated.last_validated = chrono::Utc::now().to_rfc3339();
    save_license_file(&app, &updated);

    Ok(LicenseStatus {
        valid: true,
        email: updated.email,
        instance_id: updated.instance_id,
        error: None,
    })
}

fn save_license_file(app: &tauri::AppHandle, info: &LicenseFile) {
    if let Some(path) = license_file_path(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(info) {
            let _ = fs::write(path, json);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            cancel_current_scan,
            scan_folder,
            save_tags,
            save_cover,
            save_cover_from_file,
            save_cover_b64,
            read_cover_base64,
            read_file_base64,
            list_subfolders,
            dir_exists,
            generate_waveform,
            generate_waveform_rgb,
            analyze_bpm,
            count_audio_files,
            reveal_in_finder,
            open_folder,
            analyze_filename_issues,
            apply_filename_fix,
            analyze_paren_content,
            apply_paren_fix,
            find_duplicates,
            normalize_tags,
            export_rekordbox,
            export_m3u,
            export_csv,
            export_traktor_nml,
            batch_enrich_all,
            enrich_single_itunes,
            detect_dj_software,
            export_playlist_to_dj,
            open_dj_app,
            quit_app,
            save_cache,
            load_cache,
            find_new_files,
            scan_specific_files,
            list_volumes,
            check_paths_exist,
            list_dir_contents,
            activate_license_key,
            check_license_status,
            get_cue_points,
            save_cue_points,
            analyze_structure_bands,
            detect_beat_grid,
            save_beat_grid,
            save_beat_anchors,
            load_beat_anchors,
            get_scrub_pcm,
            open_file,
            download_update,
            rename_from_tags,
            save_cover_batch_from_file,
            read_all_tags,
            save_raw_tag,
            delete_raw_tag,
            get_acoustid_fingerprint,
            detect_dj_databases,
            read_rekordbox_library,
            import_cues_from_rekordbox,
            export_cues_to_rekordbox,
            export_playlists_to_rekordbox,
            read_serato_crates,
            import_serato_crates_as_playlists,
            restore_rekordbox_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
