import type { UserRow } from "../types.ts";
import { currentUserId, currentView } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler } from "../app/screen";
import { userListToCsv } from "../utils/csvExport.ts";
import { PROFILE_ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { setUserDirty, clearUserDirty } from "../utils/csvDirty.ts";
import { saveCsvViaApi } from "../utils/dataApi";
import { setUpdateAudit } from "../utils/auditFields.ts";

const PROFILE_NAME_LENGTH = 4;

let userList: UserRow[] = [];

async function fetchUserList(): Promise<UserRow[]> {
  const { header, rows } = await fetchCsv("/data/USER.csv");
  if (header.length === 0) return [];
  const list: UserRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as UserRow;
    list.push(row);
  }
  return list;
}

function getCurrentUser(): UserRow | undefined {
  return userList.find((r) => r.ID === currentUserId);
}

/** 表示名の先頭4文字（デフォルトアイコン用） */
function getDisplayNameAbbr(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  return t.slice(0, PROFILE_NAME_LENGTH);
}

function getProfileIconBgColor(): string {
  const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
  const v = colorEl?.value?.trim();
  if (v && /^#[0-9A-Fa-f]{6}$/i.test(v)) return v;
  return PROFILE_ICON_DEFAULT_COLOR;
}

/** プロフィールアイコン表示を更新。画像が設定されていれば画像を優先、なければ背景色＋表示名4文字。 */
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
  user.NAME = name;
  user.COLOR = (document.getElementById("profile-form-icon-bg-color") as HTMLInputElement)?.value?.trim() ?? "";
  user.ICON_PATH = iconPathEl?.value?.trim() ?? "";
  setUpdateAudit(user, currentUserId ?? "");

  const csv = userListToCsv(userList as unknown as Record<string, string>[]);
  await saveCsvViaApi("USER.csv", csv);
  clearUserDirty();
}

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
        } catch (_) {
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

/** 画面遷移時に呼ぶ。フォーム内容を userList に反映し USER.csv を保存する（Tauri 時）。保存完了後に clearUserDirty。 */
export function saveUserCsvOnNavigate(): Promise<void> {
  const user = getCurrentUser();
  if (user) {
    const nameEl = document.getElementById("profile-form-name") as HTMLInputElement;
    const iconPathEl = document.getElementById("profile-form-icon-path") as HTMLInputElement;
    const colorEl = document.getElementById("profile-form-icon-bg-color") as HTMLInputElement;
    if (nameEl) user.NAME = nameEl.value.trim();
    if (colorEl) user.COLOR = colorEl.value?.trim() ?? "";
    if (iconPathEl) user.ICON_PATH = iconPathEl.value?.trim() ?? "";
    setUpdateAudit(user, currentUserId ?? "");
  }
  const csv = userListToCsv(userList as unknown as Record<string, string>[]);
  return saveCsvViaApi("USER.csv", csv).then(() => clearUserDirty());
}

export async function loadAndRenderProfile(): Promise<void> {
  userList = await fetchUserList();
  renderProfileForm();
}

export function initProfileView(): void {
  registerViewHandler("profile", loadAndRenderProfile);

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
        } catch (_) { /* 削除失敗は無視 */ }
      }
    }
    updateProfileIconDisplay();
  });
}
