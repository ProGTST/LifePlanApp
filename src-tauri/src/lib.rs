#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::Manager;

use base64::Engine;

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PROFILE_ICON_PREFIX: &str = "/icon/profile/";

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

fn write_csv(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e: io::Error| e.to_string())
}

/// フロントの convertFileSrc 用に、正規化したパス文字列を返す。
/// Windows: verbatim プレフィックス（\\?\）を除去し、バックスラッシュを / に変換する。
#[cfg(windows)]
fn path_to_display_string(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/")
}

#[cfg(not(windows))]
fn path_to_display_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn csv_has_data_lines(csv: &str) -> bool {
    csv.trim().lines().count() >= 2
}

// ---------------------------------------------------------------------------
// パス解決（開発時: public、本番: app_data_dir）
// ---------------------------------------------------------------------------

/// 開発時: exe の位置からプロジェクトルートの public/data/ を返す。
fn project_public_data_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .map(|p| p.join("public").join("data"))
}

/// 開発時: プロジェクトルートの public/icon/profile/ を返す。失敗時は current_dir を利用。
fn project_public_profile_icon_dir() -> Option<PathBuf> {
    if let Some(ref data_dir) = project_public_data_dir() {
        if let Some(public_dir) = data_dir.parent() {
            let dir = public_dir.join("icon").join("profile");
            let _ = fs::create_dir_all(&dir);
            return Some(dir);
        }
    }
    std::env::current_dir().ok().map(|cwd| {
        let dir = cwd.join("public").join("icon").join("profile");
        let _ = fs::create_dir_all(&dir);
        dir
    })
}

/// app_data_dir/data/ を返し、存在しなければ作成する。
fn app_data_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = base.join("data");
    let _ = fs::create_dir_all(&dir);
    Ok(dir)
}

/// public/data/ にデータ行がある場合のみ CSV を保存（開発時のみ。ヘッダーだけの上書きを防ぐ）。
fn save_csv_to_public_if_has_data(filename: &str, contents: &str) {
    if cfg!(debug_assertions) {
        if let Some(ref dir) = project_public_data_dir() {
            let _ = fs::create_dir_all(dir);
            if csv_has_data_lines(contents) {
                let _ = write_csv(&dir.join(filename), contents);
            }
        }
    }
}

/// app_data_dir/data/ に CSV を保存する。
fn save_csv_to_app_data(app: &tauri::AppHandle, filename: &str, contents: &str) -> Result<(), String> {
    let dir = app_data_data_dir(app)?;
    write_csv(&dir.join(filename), contents)
}

/// プロフィールアイコン用ディレクトリ（開発時は public/icon/profile、本番は app_data_dir/icon/profile）。
fn profile_icon_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Some(dir) = project_public_profile_icon_dir() {
            return Ok(dir);
        }
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = base.join("icon").join("profile");
    let _ = fs::create_dir_all(&dir);
    Ok(dir)
}

/// icon_path（/icon/profile/xxx.png）を実ファイルの PathBuf に解決する。無効または未存在なら None。
fn resolve_profile_icon_path(app: &tauri::AppHandle, icon_path: &str) -> Option<PathBuf> {
    if !icon_path.starts_with(PROFILE_ICON_PREFIX) {
        return None;
    }
    let file_name = icon_path.trim_start_matches(PROFILE_ICON_PREFIX);
    if file_name.is_empty() || file_name.contains("..") {
        return None;
    }
    if cfg!(debug_assertions) {
        if let Some(ref dir) = project_public_profile_icon_dir() {
            let p = dir.join(file_name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    let base = app.path().app_data_dir().ok()?;
    let p = base.join("icon").join("profile").join(file_name);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Tauri コマンド: 汎用・CSV
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Tauri!", name)
}

#[tauri::command]
fn save_master_csv(
    app: tauri::AppHandle,
    account: String,
    category: String,
    tag: String,
) -> Result<(), String> {
    save_csv_to_public_if_has_data("ACCOUNT.csv", &account);
    save_csv_to_public_if_has_data("CATEGORY.csv", &category);
    save_csv_to_public_if_has_data("TAG.csv", &tag);
    save_csv_to_app_data(&app, "ACCOUNT.csv", &account)?;
    save_csv_to_app_data(&app, "CATEGORY.csv", &category)?;
    save_csv_to_app_data(&app, "TAG.csv", &tag)?;
    Ok(())
}

#[tauri::command]
fn save_account_csv(app: tauri::AppHandle, account: String) -> Result<(), String> {
    save_csv_to_public_if_has_data("ACCOUNT.csv", &account);
    save_csv_to_app_data(&app, "ACCOUNT.csv", &account)
}

#[tauri::command]
fn save_category_csv(app: tauri::AppHandle, category: String) -> Result<(), String> {
    save_csv_to_public_if_has_data("CATEGORY.csv", &category);
    save_csv_to_app_data(&app, "CATEGORY.csv", &category)
}

#[tauri::command]
fn save_tag_csv(app: tauri::AppHandle, tag: String) -> Result<(), String> {
    save_csv_to_public_if_has_data("TAG.csv", &tag);
    save_csv_to_app_data(&app, "TAG.csv", &tag)
}

#[tauri::command]
fn save_user_csv(app: tauri::AppHandle, user: String) -> Result<(), String> {
    save_csv_to_public_if_has_data("USER.csv", &user);
    save_csv_to_app_data(&app, "USER.csv", &user)
}

#[tauri::command]
fn save_color_palette_csv(app: tauri::AppHandle, palette: String) -> Result<(), String> {
    save_csv_to_public_if_has_data("COLOR_PALETTE.csv", &palette);
    save_csv_to_app_data(&app, "COLOR_PALETTE.csv", &palette)
}

// ---------------------------------------------------------------------------
// Tauri コマンド: プロフィールアイコン
// ---------------------------------------------------------------------------

#[tauri::command]
fn save_profile_icon(
    app: tauri::AppHandle,
    base64_content: String,
    _filename: String,
) -> Result<String, String> {
    let data = base64_content.trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let dir = profile_icon_dir(&app)?;
    let ext = "png";
    let name = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let path = dir.join(format!("{}.{}", name, ext));
    fs::write(&path, bytes).map_err(|e: io::Error| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("icon.png");
    Ok(format!("{}{}", PROFILE_ICON_PREFIX, file_name))
}

#[tauri::command]
fn delete_profile_icon(app: tauri::AppHandle, icon_path: String) -> Result<(), String> {
    if !icon_path.starts_with(PROFILE_ICON_PREFIX) {
        return Ok(());
    }
    let file_name = icon_path.trim_start_matches(PROFILE_ICON_PREFIX);
    if file_name.is_empty() || file_name.contains("..") {
        return Ok(());
    }
    let dir = profile_icon_dir(&app)?;
    let path = dir.join(file_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e: io::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_profile_icon_path(app: tauri::AppHandle, icon_path: String) -> Result<String, String> {
    if !icon_path.starts_with(PROFILE_ICON_PREFIX) {
        return Ok(icon_path);
    }
    match resolve_profile_icon_path(&app, &icon_path) {
        Some(p) => Ok(path_to_display_string(&p)),
        None => Ok(icon_path),
    }
}

#[tauri::command]
fn get_profile_icon_base64(app: tauri::AppHandle, icon_path: String) -> Result<String, String> {
    if !icon_path.starts_with(PROFILE_ICON_PREFIX) {
        return Ok(icon_path);
    }
    let file_name = icon_path.trim_start_matches(PROFILE_ICON_PREFIX);
    if file_name.is_empty() || file_name.contains("..") {
        return Ok(icon_path);
    }
    let path = resolve_profile_icon_path(&app, &icon_path)
        .ok_or_else(|| "profile icon file not found".to_string())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", encoded))
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_master_csv,
            save_account_csv,
            save_category_csv,
            save_tag_csv,
            save_user_csv,
            save_color_palette_csv,
            save_profile_icon,
            delete_profile_icon,
            get_profile_icon_path,
            get_profile_icon_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
