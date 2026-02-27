import type { UserRow } from "../types.ts";
import { currentUserId, currentView } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { userListToCsv } from "../utils/csvExport.ts";
import { PROFILE_ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { setUserDirty, clearUserDirty } from "../utils/csvDirty.ts";
import { saveCsvViaApi } from "../utils/dataApi";
import { setUpdateAudit } from "../utils/auditFields.ts";
import {
  checkVersionBeforeUpdate,
  getVersionConflictMessage,
} from "../utils/csvVersionCheck.ts";
import { setDisplayedKeys } from "../utils/csvWatch.ts";

const PROFILE_NAME_LENGTH = 4;

let userList: UserRow[] = [];

/**
 * USER.csv を取得し、ユーザー行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わず再取得する（最新化ボタン用）
 * @returns Promise。ユーザー行の配列
 */
async function fetchUserList(noCache = false): Promise<UserRow[]> {
  const { header, rows } = await fetchCsv("/data/USER.csv");
  if (header.length === 0) return [];
  const list: UserRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as UserRow;
    list.push(row);
  }
  return list;
}

/**
 * ログインユーザーに該当するユーザー行を返す。
 * @returns 該当行または undefined
 */
function getCurrentUser(): UserRow | undefined {
  return userList.find((r) => r.ID === currentUserId);
}

/**
 * 表示名の先頭4文字を返す（デフォルトアイコン用略称）。
 * @param name - 表示名
 * @returns 先頭 PROFILE_NAME_LENGTH 文字
 */
function getDisplayNameAbbr(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  return t.slice(0, PROFILE_NAME_LENGTH);
}

/**
 * プロフィールフォームのアイコン背景色入力の値を返す。無効な場合はデフォルト色。
 * @returns 色の文字列（#rrggbb）
 */
function getProfileIconBgColor(): string {
  const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
  const v = colorEl?.value?.trim();
  if (v && /^#[0-9A-Fa-f]{6}$/i.test(v)) return v;
  return PROFILE_ICON_DEFAULT_COLOR;
}

/**
 * プロフィールフォームのアイコン表示を更新する。画像が設定されていれば画像を優先、なければ背景色＋表示名4文字。
 * @returns Promise
 */
async function updateProfileIconDisplay(): Promise<void> {
  const container = document.getElementById("profile-form-icon-display");
  const nameEl = document.getElementById("profile-form-name") as HTMLInputElement;
  const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
  if (!container) return;

  const name = nameEl?.value?.trim() ?? "";
  const iconPath = (iconPathEl?.value ?? "").trim();

  container.innerHTML = "";
  container.removeAttribute("data-mode");

  if (iconPath) {
    container.setAttribute("data-mode", "image");
    container.style.backgroundColor = "";
    const img = document.createElement("img");
    img.alt = "";
    img.className = "profile-icon-img";

    // Tauri 環境では get_profile_icon_base64 で data URL を取得、それ以外はパスをそのまま src に
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const dataUrl = await invoke<string>("get_profile_icon_base64", { iconPath });
        img.src = dataUrl && dataUrl.startsWith("data:") ? dataUrl : iconPath;
      } catch {
        img.src = iconPath;
      }
    } else {
      img.src = iconPath;
    }
    container.appendChild(img);
  } else {
    container.setAttribute("data-mode", "default");
    const abbr = getDisplayNameAbbr(name);
    const bgColor = getProfileIconBgColor();
    container.style.backgroundColor = bgColor;
    container.textContent = abbr;
  }
}

/**
 * プロフィールフォームに現在ユーザーの名前・色・アイコンパスを描画する。
 * @returns なし
 */
function renderProfileForm(): void {
  const user = getCurrentUser();
  const nameEl = document.getElementById("profile-form-name") as HTMLInputElement;
  const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
  const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
  const hexEl = document.getElementById("profile-form-icon-bg-hex") as HTMLInputElement;
  const fileInput = document.getElementById("profile-form-icon-file") as HTMLInputElement;
  if (!nameEl || !iconPathEl) return;
  if (fileInput) fileInput.value = "";

  const bgColor = (user?.COLOR ?? "").trim() || PROFILE_ICON_DEFAULT_COLOR;
  if (colorEl) colorEl.value = bgColor;
  if (hexEl) hexEl.value = bgColor;

  if (user) {
    nameEl.value = user.NAME ?? "";
    iconPathEl.value = user.ICON_PATH ?? "";
  } else {
    nameEl.value = "";
    iconPathEl.value = "";
  }
  updateProfileIconDisplay();
}

/**
 * プロフィールフォームの内容を検証し、USER.csv に保存する。バージョンチェック後に clearUserDirty。
 * @returns Promise
 */
async function saveProfileForm(): Promise<void> {
  const user = getCurrentUser();
  if (!user) return;
  const nameEl = document.getElementById("profile-form-name") as HTMLInputElement;
  const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
  if (!nameEl) return;
  const name = nameEl.value.trim();
  if (!name) {
    nameEl.focus();
    return;
  }
  const check = await checkVersionBeforeUpdate(
    "/data/USER.csv",
    user.ID,
    user.VERSION ?? "0"
  );
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderProfile();
    return;
  }
  user.NAME = name;
  user.COLOR = (document.getElementById("profile-form-icon-bg-color") as HTMLInputElement)?.value?.trim() ?? "";
  user.ICON_PATH = iconPathEl?.value?.trim() ?? "";
  setUpdateAudit(user as unknown as Record<string, string>, currentUserId ?? "");

  const csv = userListToCsv(userList as unknown as Record<string, string>[]);
  await saveCsvViaApi("USER.csv", csv);
  clearUserDirty();
}

/**
 * プロフィールアイコンのファイル選択時に呼ばれる。Tauri 時は save_profile_icon で保存し、ブラウザ時は Data URL をセットする。
 * @param e - イベント（input[type=file] の change）
 * @returns Promise
 */
async function handleProfileIconFileSelect(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
  if (!isTauri) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
      if (iconPathEl) {
        iconPathEl.value = dataUrl;
        setUserDirty();
        updateProfileIconDisplay();
      }
    };
    reader.readAsDataURL(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const buf = reader.result as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
      const oldPath = (iconPathEl?.value ?? "").trim();
      if (oldPath.startsWith("/icon/profile/")) {
        try {
          await invoke("delete_profile_icon", { iconPath: oldPath });
        } catch {
          /* 削除失敗は無視（ファイルが無い等） */
        }
      }
      const path = await invoke<string>("save_profile_icon", {
        base64Content: base64,
        filename: file.name || "icon.png",
      });
      if (iconPathEl) {
        iconPathEl.value = path;
        const user = getCurrentUser();
        if (user) user.ICON_PATH = path;
        setUserDirty();
        await updateProfileIconDisplay();
      }
    } catch (err) {
      console.error("save_profile_icon failed", err);
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = "";
}

/**
 * 画面遷移時に呼ぶ。フォーム内容を userList に反映し USER.csv を API 経由で保存する。保存完了後に clearUserDirty を呼ぶ。
 * @returns Promise（保存とクリア完了で resolve）
 */
export function saveUserCsvOnNavigate(): Promise<void> {
  const user = getCurrentUser();
  if (user) {
    const nameEl = document.getElementById("profile-form-name") as HTMLInputElement;
    const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
    const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
    if (nameEl) user.NAME = nameEl.value.trim();
    if (colorEl) user.COLOR = colorEl.value?.trim() ?? "";
    if (iconPathEl) user.ICON_PATH = iconPathEl.value?.trim() ?? "";
    setUpdateAudit(user as unknown as Record<string, string>, currentUserId ?? "");
  }
  const csv = userListToCsv(userList as unknown as Record<string, string>[]);
  return saveCsvViaApi("USER.csv", csv).then(() => clearUserDirty());
}

/**
 * USER.csv からユーザー一覧を取得し、プロフィールフォームを描画する。表示キーを setDisplayedKeys に登録する。
 * @param forceReloadFromCsv - true のときキャッシュを使わず CSV を再取得する（最新化ボタン用）
 * @returns Promise
 */
export async function loadAndRenderProfile(forceReloadFromCsv = false): Promise<void> {
  userList = await fetchUserList(forceReloadFromCsv);
  setDisplayedKeys("profile", currentUserId ? [currentUserId] : []);
  renderProfileForm();
}

/**
 * プロフィール画面の初期化を行う。「profile」ビュー表示ハンドラと保存・色ピッカー・ファイル選択のイベントを登録する。
 * @returns なし
 */
export function initProfileView(): void {
  registerViewHandler("profile", loadAndRenderProfile);
  registerRefreshHandler("profile", () => loadAndRenderProfile(true));

  document.getElementById("header-save-btn")?.addEventListener("click", async () => {
    if (currentView !== "profile") return;
    await saveProfileForm();
  });

  document.getElementById("profile-form-icon-bg-picker-btn")?.addEventListener("click", () => {
    const currentColor = getProfileIconBgColor();
    openColorIconPicker(currentColor, "", (color) => {
      const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
      const hexEl = document.getElementById("profile-form-icon-bg-hex") as HTMLInputElement;
      if (colorEl) colorEl.value = color;
      if (hexEl) hexEl.value = color;
      setUserDirty();
      updateProfileIconDisplay();
    }, { showIconSection: false });
  });

  document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveProfileForm();
  });

  document.getElementById("profile-form-name")?.addEventListener("input", () => {
    setUserDirty();
    const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
    if (!(iconPathEl?.value ?? "").trim()) updateProfileIconDisplay();
  });

  const colorEl = document.getElementById("profile-form-icon-bg-color");
  const hexEl = document.getElementById("profile-form-icon-bg-hex");
  colorEl?.addEventListener("input", () => {
    setUserDirty();
    const v = (colorEl as HTMLInputElement).value;
    if (hexEl) (hexEl as HTMLInputElement).value = v;
    updateProfileIconDisplay();
  });
  hexEl?.addEventListener("input", () => {
    setUserDirty();
    let v = (hexEl as HTMLInputElement).value.trim();
    if (v && !v.startsWith("#")) v = "#" + v;
    if (v && /^#[0-9A-Fa-f]{6}$/i.test(v)) {
      (colorEl as HTMLInputElement).value = v;
      updateProfileIconDisplay();
    }
  });

  document.getElementById("profile-form-icon-upload-btn")?.addEventListener("click", () => {
    document.getElementById("profile-form-icon-file")?.click();
  });

  document.getElementById("profile-form-icon-file")?.addEventListener("change", (e) => {
    handleProfileIconFileSelect(e);
  });

  document.getElementById("profile-form-icon-default-btn")?.addEventListener("click", async () => {
    const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
    const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
    const hexEl = document.getElementById("profile-form-icon-bg-hex") as HTMLInputElement;
    const oldPath = (iconPathEl?.value ?? "").trim();
    if (iconPathEl) iconPathEl.value = "";
    if (colorEl) colorEl.value = PROFILE_ICON_DEFAULT_COLOR;
    if (hexEl) hexEl.value = PROFILE_ICON_DEFAULT_COLOR;
    setUserDirty();
    if (oldPath.startsWith("/icon/profile/")) {
      const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("delete_profile_icon", { iconPath: oldPath });
        } catch { /* 削除失敗は無視 */ }
      }
    }
    updateProfileIconDisplay();
  });
}
