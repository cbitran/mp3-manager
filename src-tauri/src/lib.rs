use base64::Engine;
use urlencoding;
use id3::frame::{Comment as Id3Comment, Picture, PictureType};
use id3::TagLike;
use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

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

    // Use lofty for all format-agnostic reading
    let tagged = Probe::open(path).ok()?.read().ok()?;
    let props = tagged.properties();
    let duration_secs = Some(props.duration().as_secs_f64()).filter(|&d| d > 0.0);
    let bitrate_kbps = props.audio_bitrate();
    let sample_rate_hz = props.sample_rate();

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let title        = tag.and_then(|t| t.title()).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let artist       = tag.and_then(|t| t.artist()).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let album        = tag.and_then(|t| t.album()).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let genre        = tag.and_then(|t| t.genre()).map(|s| s.to_string()).filter(|s| !s.is_empty());
    let year         = tag.and_then(|t| t.year()).map(|y| y as u32);
    let track_number = tag.and_then(|t| t.track());
    let has_cover    = tag.map(|t| !t.pictures().is_empty()).unwrap_or(false);

    // BPM, KEY, RATING, COMMENT, TOTAL_TRACKS — read via id3 crate for MP3/AIFF
    let (bpm, key, rating, comment, total_tracks) = if format == "MP3" || format == "AIFF" || format == "AIF" {
        if let Ok(id3tag) = id3::Tag::read_from_path(path) {
            let bpm = id3tag.frames().find(|f| f.id() == "TBPM").and_then(|f| {
                if let id3::Content::Text(t) = f.content() { Some(t.trim().to_string()) } else { None }
            }).filter(|s| !s.is_empty());
            let key = id3tag.frames().find(|f| f.id() == "TKEY").and_then(|f| {
                if let id3::Content::Text(t) = f.content() { Some(t.trim().to_string()) } else { None }
            }).filter(|s| !s.is_empty());
            let rating = id3tag.extended_texts()
                .find(|e| e.description.eq_ignore_ascii_case("rating"))
                .and_then(|e| e.value.trim().parse::<u8>().ok())
                .filter(|&r| r >= 1 && r <= 5);
            let comment = id3tag.comments().next().map(|c| c.text.clone()).filter(|s| !s.is_empty());
            let total_tracks = id3tag.frames().find(|f| f.id() == "TRCK").and_then(|f| {
                if let id3::Content::Text(t) = f.content() {
                    t.split('/').nth(1).and_then(|s| s.trim().parse::<u32>().ok())
                } else { None }
            });
            (bpm, key, rating, comment, total_tracks)
        } else {
            (None, None, None, None, None)
        }
    } else {
        // For FLAC/OGG: BPM and KEY in Vorbis comments
        let bpm = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Bpm))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        let key = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::InitialKey))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        let comment = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Comment))
            .map(|s| s.to_string()).filter(|s| !s.is_empty());
        let total_tracks = tag.and_then(|t| t.track_total());
        (bpm, key, None, comment, total_tracks)
    };

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
        bitrate_kbps, sample_rate_hz, modified_at, comment, total_tracks,
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
fn scan_folder(folder: String, app: tauri::AppHandle) -> Vec<Track> {
    let paths: Vec<_> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension()
                    .map(|ext| AUDIO_EXTENSIONS.iter().any(|&a| ext.eq_ignore_ascii_case(a)))
                    .unwrap_or(false)
        })
        .map(|e| e.path().to_path_buf())
        .collect();
    let total = paths.len();
    let counter = Arc::new(AtomicUsize::new(0));
    paths.par_iter().filter_map(|p| {
        let result = read_track(p);
        let done = counter.fetch_add(1, Ordering::Relaxed) + 1;
        if done % 10 == 0 || done == total {
            let _ = app.emit("scan_progress", serde_json::json!({ "done": done, "total": total }));
        }
        result
    }).collect()
}

#[tauri::command]
fn save_tags(
    path: String, title: Option<String>, artist: Option<String>,
    album: Option<String>, genre: Option<String>, year: Option<u32>,
    track_number: Option<u32>, bpm: Option<String>, key: Option<String>,
    rating: Option<u8>, comment: Option<String>, total_tracks: Option<u32>,
) -> Result<(), String> {
    let fmt = file_format(Path::new(&path));
    if fmt == "FLAC" || fmt == "OGG" || fmt == "OPUS" {
        // Use lofty for non-ID3 formats
        let mut tagged = Probe::open(&path).map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        let tag = tagged.primary_tag_mut().ok_or("sem tag")?;
        if let Some(v) = title        { tag.set_title(v.into()); }
        if let Some(v) = artist       { tag.set_artist(v.into()); }
        if let Some(v) = album        { tag.set_album(v.into()); }
        if let Some(v) = genre        { tag.set_genre(v.into()); }
        if let Some(v) = year         { tag.set_year(v); }
        if let Some(v) = track_number { tag.set_track(v); }
        if let Some(v) = total_tracks { tag.set_track_total(v); }
        tagged.save_to_path(&path, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())?;
    } else {
        let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
        if let Some(v) = title        { tag.set_title(v); }
        if let Some(v) = artist       { tag.set_artist(v); }
        if let Some(v) = album        { tag.set_album(v); }
        if let Some(v) = genre        { tag.set_genre(v); }
        if let Some(v) = year         { tag.set_year(v as i32); }
        // TRCK frame: handle track_number and total_tracks together
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
            tag.remove_extended_text(None, Some("RATING"));
            tag.add_frame(id3::frame::ExtendedText { description: "RATING".to_string(), value: r.to_string() });
        }
        if let Some(v) = comment {
            tag.remove("COMM");
            if !v.is_empty() {
                tag.add_frame(Id3Comment { lang: "por".to_string(), description: String::new(), text: v });
            }
        }
        tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn save_cover(path: String, cover_url: String) -> Result<(), String> {
    let client = cover_client();
    let cover_data = client.get(&cover_url).send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?.to_vec();
    let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
    tag.remove("APIC");
    tag.add_frame(Picture {
        mime_type: "image/jpeg".to_string(),
        picture_type: PictureType::CoverFront,
        description: String::new(),
        data: cover_data,
    });
    tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_cover_from_file(path: String, image_path: String) -> Result<(), String> {
    let cover_data = fs::read(&image_path).map_err(|e| e.to_string())?;
    let mime = if image_path.to_lowercase().ends_with(".png") {
        "image/png".to_string()
    } else {
        "image/jpeg".to_string()
    };
    let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());
    tag.remove("APIC");
    tag.add_frame(Picture {
        mime_type: mime,
        picture_type: PictureType::CoverFront,
        description: String::new(),
        data: cover_data,
    });
    tag.write_to_path(&path, id3::Version::Id3v24).map_err(|e| e.to_string())
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
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn trash_folder(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn dir_exists(path: String) -> bool {
    Path::new(&path).is_dir()
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

    let fname = path.split('/').last().unwrap_or(&path).to_string();

    if duration_secs <= 0.0 {
        eprintln!("[BPM] {} — SKIP: duration_secs={}", fname, duration_secs);
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
        eprintln!("[BPM] {} — formato: MP3/ID3, skip {} bytes", fname, 10 + sz);
        (10 + sz).min(file_len)
    } else if &hdr[..4] == b"fLaC" {
        // FLAC: pula metadados até encontrar blocos de áudio
        // Heurística: os metadados FLAC raramente ultrapassam 128 KB
        let skip = (128 * 1024).min(file_len / 4);
        eprintln!("[BPM] {} — formato: FLAC, skip heurístico {} bytes", fname, skip);
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
        eprintln!("[BPM] {} — formato: WAV, data chunk em {} bytes", fname, data_start);
        data_start
    } else if &hdr[4..8] == b"ftyp" {
        // M4A / AAC / MP4 container — pula para mdat heuristicamente
        let skip = (4 * 1024).min(file_len / 4);
        eprintln!("[BPM] {} — formato: M4A/MP4, skip heurístico {} bytes", fname, skip);
        skip
    } else {
        eprintln!("[BPM] {} — formato desconhecido (magic={:?}), começa em 0", fname, &hdr[..4]);
        0
    };

    let audio_len = file_len.saturating_sub(audio_start);
    if audio_len < BARS {
        eprintln!("[BPM] {} — SKIP: audio_len={} < {}", fname, audio_len, BARS);
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

    eprintln!("[BPM] {} — picos={} mean_onset={:.4} threshold={:.4}", fname, peaks.len(), mean_onset, threshold);

    if peaks.len() < 6 {
        eprintln!("[BPM] {} — SKIP: poucos picos ({})", fname, peaks.len());
        return Ok(None);
    }

    // Intervalos em segundos entre picos consecutivos
    let mut intervals: Vec<f32> = peaks.windows(2)
        .map(|w| (w[1] - w[0]) as f32 * secs_per_bar)
        .filter(|&d| d > 0.18 && d < 2.5) // 24–333 BPM brutos
        .collect();

    if intervals.is_empty() {
        eprintln!("[BPM] {} — SKIP: sem intervalos válidos", fname);
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

    eprintln!("[BPM] {} — RESULTADO: {}", fname, bpm);
    Ok(Some(bpm))
}

// Retorna Vec de tamanho bars*3: [amp, bass, treble, ...]
// Usa seek para ler apenas ~4 KB por barra — sem carregar o arquivo inteiro.
#[tauri::command]
fn generate_waveform_rgb(path: String, bars: usize) -> Result<Vec<f32>, String> {
    use std::io::{Read, Seek, SeekFrom};

    if bars == 0 {
        return Ok(vec![]);
    }

    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let file_len = file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())? as usize;

    // Detectar e pular cabeçalho ID3 (primeiros 10 bytes)
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hdr = [0u8; 10];
    let audio_start = if file.read(&mut hdr).ok() == Some(10) && &hdr[..3] == b"ID3" {
        let sz = ((hdr[6] as usize & 0x7F) << 21)
               | ((hdr[7] as usize & 0x7F) << 14)
               | ((hdr[8] as usize & 0x7F) << 7)
               | (hdr[9] as usize & 0x7F);
        (10 + sz).min(file_len)
    } else {
        0
    };

    let audio_len = file_len.saturating_sub(audio_start);
    if audio_len < bars {
        return Ok(vec![0.3, 0.5, 0.5].into_iter().cycle().take(bars * 3).collect());
    }

    // Lê SAMPLE_BYTES por barra via seek — nunca carrega o arquivo inteiro
    const SAMPLE_BYTES: usize = 4096;
    let bar_span = audio_len / bars;

    let mut amps    = vec![0.0f32; bars];
    let mut basses  = vec![0.0f32; bars];
    let mut trebles = vec![0.0f32; bars];
    let mut buf = vec![0u8; SAMPLE_BYTES];

    for i in 0..bars {
        let pos = audio_start + i * bar_span;
        if file.seek(SeekFrom::Start(pos as u64)).is_err() { continue; }
        let n = file.read(&mut buf).unwrap_or(0);
        if n < 2 { continue; }
        let slice = &buf[..n];

        let sum_abs: u64 = slice.iter()
            .map(|&b| (b as i16 - 128).unsigned_abs() as u64)
            .sum();
        amps[i] = sum_abs as f32 / (n as f32 * 128.0);

        let dec_sum: f32 = slice.iter().step_by(8)
            .map(|&b| { let v = (b as f32 - 128.0) / 128.0; v * v })
            .sum();
        let dec_n = (n / 8).max(1) as f32;
        basses[i] = (dec_sum / dec_n).sqrt();

        let diff_sq: f32 = slice.windows(2)
            .map(|w| { let d = w[1] as f32 - w[0] as f32; d * d })
            .sum();
        trebles[i] = (diff_sq / (n - 1) as f32).sqrt() / 256.0;
    }

    let norm = |v: &mut Vec<f32>| {
        let mx = v.iter().cloned().fold(1e-9f32, f32::max);
        v.iter_mut().for_each(|x| *x /= mx);
    };
    norm(&mut amps);
    norm(&mut basses);
    norm(&mut trebles);

    let mut out = Vec::with_capacity(bars * 3);
    for i in 0..bars {
        out.push(amps[i]);
        out.push(basses[i]);
        out.push(trebles[i]);
    }
    Ok(out)
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

fn clean_filename_str(name: &str) -> (String, Vec<String>) {
    let mut issues = vec![];
    let (stem, ext) = if let Some(dot) = name.rfind('.') {
        (&name[..dot], &name[dot..])
    } else {
        (name, "")
    };

    let mut s = stem.to_string();

    if s.contains('_') {
        s = s.replace('_', " ");
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
    paths.par_iter().filter_map(|path| {
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
    paths.par_iter().filter_map(|path| {
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
                if dirty { tag.write_to_path(path, id3::Version::Id3v24).ok()?; }
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
                if dirty { tagged.save_to_path(path, lofty::config::WriteOptions::default()).ok()?; }
                Some(dirty)
            })().unwrap_or(false)
        };
        NormalizeResult { path: path.clone(), changed }
    }).collect()
}

// ── Rekordbox XML Export ──────────────────────────────────────────────────────

#[tauri::command]
fn export_rekordbox(tracks: Vec<Track>, output_path: String) -> Result<usize, String> {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<DJ_PLAYLISTS Version=\"1.0.0\">\n");
    xml.push_str("  <PRODUCT Name=\"TagWave\" Version=\"0.3.0\" Company=\"Bitran\"/>\n");
    xml.push_str("  <COLLECTION Entries=\"");
    xml.push_str(&tracks.len().to_string());
    xml.push_str("\">\n");

    for track in &tracks {
        let title   = xml_escape(track.title.as_deref().unwrap_or(&track.filename));
        let artist  = xml_escape(track.artist.as_deref().unwrap_or(""));
        let album   = xml_escape(track.album.as_deref().unwrap_or(""));
        let genre   = xml_escape(track.genre.as_deref().unwrap_or(""));
        let bpm     = track.bpm.as_deref().unwrap_or("0");
        let key     = xml_escape(track.key.as_deref().unwrap_or(""));
        let year    = track.year.map(|y| y.to_string()).unwrap_or_default();
        let dur_s   = track.duration_secs.map(|d| format!("{:.3}", d)).unwrap_or_default();
        let size    = track.file_size_bytes;
        // Rekordbox expects file:// URI
        let loc = if track.path.starts_with('/') {
            format!("file://{}", track.path.replace(' ', "%20"))
        } else {
            format!("file:///{}", track.path.replace('\\', "/").replace(' ', "%20"))
        };

        xml.push_str(&format!(
            "    <TRACK TrackID=\"{}\" Name=\"{}\" Artist=\"{}\" Album=\"{}\" Genre=\"{}\" \
             TotalTime=\"{}\" AverageBpm=\"{}\" Tonality=\"{}\" Year=\"{}\" Size=\"{}\" \
             Location=\"{}\"/>\n",
            &track.id[..8], title, artist, album, genre,
            dur_s, bpm, key, year, size, loc
        ));
    }

    xml.push_str("  </COLLECTION>\n");
    xml.push_str("  <PLAYLISTS>\n    <NODE Type=\"0\" Name=\"ROOT\" Count=\"1\">\n");
    xml.push_str("      <NODE Name=\"TagWave Export\" Type=\"1\" KeyType=\"0\" Entries=\"");
    xml.push_str(&tracks.len().to_string());
    xml.push_str("\">\n");
    for track in &tracks {
        xml.push_str(&format!("        <TRACK Key=\"{}\"/>\n", &track.id[..8]));
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

    eprintln!("[iTunes] Buscando: {:?}  |  arquivo: {}", term, path.split('/').last().unwrap_or(path));

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => { eprintln!("[iTunes] ERRO de rede: {}", e); return None; }
    };
    let status = resp.status();
    eprintln!("[iTunes] HTTP {}", status);
    if !status.is_success() { return None; }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => { eprintln!("[iTunes] ERRO parse JSON: {}", e); return None; }
    };
    let results = json["results"].as_array()?;
    eprintln!("[iTunes] {} resultado(s) recebido(s)", results.len());

    for (i, r) in results.iter().enumerate() {
        eprintln!("  [{}] \"{}\" — \"{}\"",
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
        eprintln!("[iTunes] Nenhum resultado passou no filtro de correspondência para \"{} - {}\"", artist, title);
    } else {
        eprintln!("[iTunes] Match aceito: \"{}\" — \"{}\"",
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
        eprintln!("\n[Enrich] === Faixa {}/{} ===", idx + 1, tracks.len());
        eprintln!("[Enrich] título: {:?}  artista: {:?}", t.title, t.artist);

        // Notifica JS ANTES do delay para o highlight aparecer imediatamente
        let _ = app.emit("enrich_track_start", serde_json::json!({
            "path": t.path, "idx": idx, "total": tracks.len()
        }));

        // 3,5 s entre chamadas — seguro para o rate-limit da Apple (~20 req/min)
        if idx > 0 {
            eprintln!("[Enrich] Aguardando 3,5 s (rate-limit)…");
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
        eprintln!("[Enrich] Resultado: {} | gênero={:?} álbum={:?} ano={:?} capa={}",
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
    let candidates: &[(&str, &str, &[&str])] = &[
        ("serato", "Serato DJ Pro", &[
            "/Applications/Serato DJ Pro.app",
            "/Applications/Serato DJ Lite.app",
        ]),
        ("rekordbox", "rekordbox", &[
            "/Applications/rekordbox.app",
            "/Applications/rekordbox 6.app",
            "/Applications/rekordbox 6/rekordbox.app",
            "/Applications/rekordbox 7/rekordbox.app",
            "/Applications/rekordbox 8/rekordbox.app",
        ]),
        ("traktor", "Traktor Pro 3", &[
            "/Applications/Traktor Pro 3.app",
            "/Applications/Traktor Pro 2.app",
            "/Applications/Traktor Pro.app",
            "/Applications/Native Instruments/Traktor Pro 3.app",
        ]),
        ("vdj", "Virtual DJ", &[
            "/Applications/VirtualDJ.app",
            "/Applications/VirtualDJ 2023.app",
            "/Applications/VirtualDJ 2024.app",
            "/Applications/VirtualDJ 2025.app",
        ]),
        ("djay", "djay Pro", &[
            "/Applications/djay Pro.app",
            "/Applications/djay Pro AI.app",
            "/Applications/djay.app",
        ]),
    ];
    candidates.iter().map(|(id, name, paths)| {
        let installed = paths.iter().any(|p| Path::new(p).exists());
        DjSoftwareInfo { id: id.to_string(), name: name.to_string(), installed }
    }).collect()
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
        // Serato path: strip leading "/" and keep as-is for modern Serato DJ Pro
        let serato_path = track.path.trim_start_matches('/');
        let serato_path = format!("Macintosh HD/{}", serato_path);
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
        let components: Vec<&str> = parent.components()
            .filter_map(|c| match c {
                std::path::Component::Normal(s) => s.to_str(),
                _ => None,
            })
            .collect();
        let dir = format!("/:{}/:", components.join("/:"));
        let key = format!("Macintosh HD{}{}", dir, filename);
        ("Macintosh HD".to_string(), dir, key)
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
            // Reuse existing Rekordbox XML logic
            let output = path.to_string_lossy().to_string();
            export_rekordbox(tracks, output.clone())?;
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
    let app_paths: &[(&str, &[&str])] = &[
        ("serato", &[
            "/Applications/Serato DJ Pro.app",
            "/Applications/Serato DJ Lite.app",
        ]),
        ("rekordbox", &[
            "/Applications/rekordbox 7/rekordbox.app",
            "/Applications/rekordbox 6/rekordbox.app",
            "/Applications/rekordbox.app",
            "/Applications/rekordbox 6.app",
        ]),
        ("traktor", &[
            "/Applications/Traktor Pro 3.app",
            "/Applications/Traktor Pro 2.app",
            "/Applications/Traktor Pro.app",
            "/Applications/Native Instruments/Traktor Pro 3.app",
        ]),
        ("vdj", &[
            "/Applications/VirtualDJ.app",
            "/Applications/VirtualDJ 2025.app",
            "/Applications/VirtualDJ 2024.app",
            "/Applications/VirtualDJ 2023.app",
        ]),
        ("djay", &[
            "/Applications/djay Pro.app",
            "/Applications/djay Pro AI.app",
            "/Applications/djay.app",
        ]),
    ];
    let paths = app_paths.iter()
        .find(|(id, _)| *id == software_id.as_str())
        .map(|(_, p)| p)
        .ok_or_else(|| format!("Software desconhecido: {}", software_id))?;

    let app_path = paths.iter()
        .find(|p| Path::new(p).exists())
        .ok_or_else(|| "Software não encontrado ou não instalado".to_string())?;

    std::process::Command::new("open")
        .arg(app_path)
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
            e.file_type().is_file()
                && e.path().extension()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            save_tags,
            save_cover,
            save_cover_from_file,
            read_cover_base64,
            read_file_base64,
            trash_file,
            trash_folder,
            list_subfolders,
            dir_exists,
            generate_waveform,
            generate_waveform_rgb,
            analyze_bpm,
            count_audio_files,
            reveal_in_finder,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
