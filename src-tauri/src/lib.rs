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
use std::sync::Arc;
use tauri::Emitter;
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
    let cover_data = reqwest::get(&cover_url).await.map_err(|e| e.to_string())?
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
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    let audio_start = if data.len() > 10 && &data[..3] == b"ID3" {
        let size = ((data[6] as usize & 0x7F) << 21)
            | ((data[7] as usize & 0x7F) << 14)
            | ((data[8] as usize & 0x7F) << 7)
            | (data[9] as usize & 0x7F);
        (10 + size).min(data.len())
    } else {
        0
    };

    let audio = &data[audio_start..];
    if audio.is_empty() || bars == 0 {
        return Ok(vec![0.3; bars]);
    }

    let chunk = (audio.len() / bars).max(1);
    let mut result: Vec<f32> = (0..bars)
        .map(|i| {
            let s = i * chunk;
            let e = ((i + 1) * chunk).min(audio.len());
            let slice = &audio[s..e];
            let sum: u64 = slice.iter()
                .map(|&b| (b as i16 - 128).unsigned_abs() as u64)
                .sum();
            sum as f32 / (slice.len() as f32 * 128.0)
        })
        .collect();

    let max = result.iter().cloned().fold(0.0f32, f32::max);
    if max > 0.0 {
        result.iter_mut().for_each(|v| *v /= max);
    }
    Ok(result)
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

// ── Batch Enrichment (iTunes Search) ─────────────────────────────────────────

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

#[tauri::command]
async fn batch_enrich_itunes(tracks: Vec<EnrichRequest>) -> Vec<EnrichResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    let mut results = Vec::new();
    for t in &tracks {
        let term = match (&t.artist, &t.title) {
            (Some(a), Some(ti)) => format!("{} {}", a, ti),
            (Some(a), None) => a.clone(),
            (None, Some(ti)) => ti.clone(),
            _ => { results.push(EnrichResult { path: t.path.clone(), genre: None, album: None, year: None, cover_url: None }); continue; }
        };
        let url = format!(
            "https://itunes.apple.com/search?term={}&media=music&limit=3&country=US",
            urlencoding::encode(&term)
        );
        let result = (async {
            let resp = client.get(&url).send().await.ok()?;
            let json: serde_json::Value = resp.json().await.ok()?;
            let results = json["results"].as_array()?;
            let r = results.first()?;
            let genre = r["primaryGenreName"].as_str().map(|s| s.to_string());
            let album = r["collectionName"].as_str().map(|s| s.to_string());
            let year = r["releaseDate"].as_str()
                .and_then(|d| d.split('-').next())
                .and_then(|y| y.parse::<u32>().ok());
            let cover_url = r["artworkUrl100"].as_str()
                .map(|s| s.replace("100x100", "600x600"));
            Some(EnrichResult { path: t.path.clone(), genre, album, year, cover_url })
        }).await;
        results.push(result.unwrap_or_else(|| EnrichResult { path: t.path.clone(), genre: None, album: None, year: None, cover_url: None }));
    }
    results
}

// ── Entry point ───────────────────────────────────────────────────────────────

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
            trash_file,
            trash_folder,
            list_subfolders,
            generate_waveform,
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
            batch_enrich_itunes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
