use id3::TagLike;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

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
    pub rating: Option<u8>,        // 1–5 (lido de TXXX:RATING)
    pub duration_secs: Option<f64>, // de TLEN (ms → s)
    pub file_size_bytes: u64,
    pub has_cover: bool,
    pub issues: Vec<String>,
}

fn read_track(path: &Path) -> Option<Track> {
    let metadata = fs::metadata(path).ok()?;
    let file_size_bytes = metadata.len();
    let filename = path.file_name()?.to_string_lossy().to_string();

    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let id = format!("{:x}", hasher.finalize())[..16].to_string();

    let tag_result = id3::Tag::read_from_path(path);

    let (title, artist, album, genre, year, track_number, bpm, key, rating, duration_secs, has_cover) =
        match &tag_result {
            Ok(tag) => {
                let bpm = tag.frames()
                    .find(|f| f.id() == "TBPM")
                    .and_then(|f| {
                        if let id3::Content::Text(t) = f.content() { Some(t.trim().to_string()) } else { None }
                    });

                let key = tag.frames()
                    .find(|f| f.id() == "TKEY")
                    .and_then(|f| {
                        if let id3::Content::Text(t) = f.content() { Some(t.trim().to_string()) } else { None }
                    });

                let rating = tag.extended_texts()
                    .find(|e| e.description.eq_ignore_ascii_case("rating"))
                    .and_then(|e| e.value.trim().parse::<u8>().ok())
                    .filter(|&r| r >= 1 && r <= 5);

                let duration_secs = tag.duration().map(|d| d as f64 / 1000.0);

                (
                    tag.title().map(str::to_string),
                    tag.artist().map(str::to_string),
                    tag.album().map(str::to_string),
                    tag.genre().map(str::to_string),
                    tag.year().map(|y| y as u32),
                    tag.track(),
                    bpm,
                    key,
                    rating,
                    duration_secs,
                    tag.pictures().next().is_some(),
                )
            }
            Err(_) => (None, None, None, None, None, None, None, None, None, None, false),
        };

    let mut issues = Vec::new();
    if title.is_none()  { issues.push("sem título".to_string()); }
    if artist.is_none() { issues.push("sem artista".to_string()); }
    if genre.is_none()  { issues.push("sem gênero".to_string()); }
    if !has_cover       { issues.push("sem capa".to_string()); }
    if bpm.as_deref().unwrap_or("").is_empty() { issues.push("sem BPM".to_string()); }

    Some(Track {
        id,
        path: path.to_string_lossy().to_string(),
        filename,
        title,
        artist,
        album,
        genre,
        year,
        track_number,
        bpm,
        key,
        rating,
        duration_secs,
        file_size_bytes,
        has_cover,
        issues,
    })
}

#[tauri::command]
fn scan_folder(folder: String) -> Vec<Track> {
    let paths: Vec<_> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("mp3"))
                    .unwrap_or(false)
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    paths.par_iter().filter_map(|p| read_track(p)).collect()
}

#[tauri::command]
fn save_tags(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    year: Option<u32>,
    track_number: Option<u32>,
    bpm: Option<String>,
    key: Option<String>,
    rating: Option<u8>,
) -> Result<(), String> {
    let mut tag = id3::Tag::read_from_path(&path).unwrap_or_else(|_| id3::Tag::new());

    if let Some(v) = title        { tag.set_title(v); }
    if let Some(v) = artist       { tag.set_artist(v); }
    if let Some(v) = album        { tag.set_album(v); }
    if let Some(v) = genre        { tag.set_genre(v); }
    if let Some(v) = year         { tag.set_year(v as i32); }
    if let Some(v) = track_number { tag.set_track(v); }

    if let Some(v) = bpm {
        if !v.is_empty() {
            tag.add_frame(id3::Frame::text("TBPM", v));
        }
    }
    if let Some(v) = key {
        if !v.is_empty() {
            tag.add_frame(id3::Frame::text("TKEY", v));
        }
    }
    if let Some(r) = rating {
        let existing = tag.extended_texts()
            .find(|e| e.description.eq_ignore_ascii_case("rating"))
            .cloned();
        if existing.is_none() || existing.unwrap().value != r.to_string() {
            tag.remove_extended_text(None, Some("RATING"));
            tag.add_frame(id3::frame::ExtendedText {
                description: "RATING".to_string(),
                value: r.to_string(),
            });
        }
    }

    tag.write_to_path(&path, id3::Version::Id3v24)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![scan_folder, save_tags])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
