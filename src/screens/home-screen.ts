import { invoke } from "@tauri-apps/api/core";
import type { UserRow } from "../types.ts";
import { currentUserId } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler } from "../app/screen";
import { PROFILE_ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";

const PROFILE_NAME_LENGTH = 4;

let greetInputEl: HTMLInputElement | null = null;
let greetMsgEl: HTMLElement | null = null;

/**
 * 表示名の先頭 N 文字を取得する（デフォルトアイコン用略称）。
 * @param name - 表示名
 * @returns 先頭 PROFILE_NAME_LENGTH 文字（空の場合は ""）
 */
function getDisplayNameAbbr(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  return t.slice(0, PROFILE_NAME_LENGTH);
}

/**
 * USER.csv からユーザー一覧を取得する。
 * @returns Promise。UserRow の配列
 */
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

/**
 * ヘッダー左のプロフィールアイコン・表示名を描画する（ホーム表示時に呼ばれる）。
 * @returns Promise
 */
async function renderHeaderProfile(): Promise<void> {
  const iconEl = document.getElementById("header-profile-icon");
  const nameEl = document.getElementById("header-profile-name");
  if (!iconEl || !nameEl) return;

  const userList = await fetchUserList();
  const user = userList.find((r) => r.ID === currentUserId);
  const name = (user?.NAME ?? "").trim();
  const iconPath = (user?.ICON_PATH ?? "").trim();
  const bgColor = (user?.COLOR ?? "").trim() || PROFILE_ICON_DEFAULT_COLOR;

  nameEl.textContent = name || "ユーザー";
  iconEl.innerHTML = "";
  iconEl.removeAttribute("data-mode");
  iconEl.setAttribute("aria-hidden", "false");

  if (iconPath) {
    iconEl.setAttribute("data-mode", "image");
    const img = document.createElement("img");
    img.alt = "";
    img.className = "app-header-profile-icon-img";

    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
    if (isTauri) {
      try {
        const dataUrl = await invoke<string>("get_profile_icon_base64", { iconPath });
        img.src = dataUrl && !dataUrl.startsWith("/") ? dataUrl : iconPath;
      } catch {
        img.src = iconPath;
      }
    } else {
      img.src = iconPath;
    }
    iconEl.appendChild(img);
  } else {
    iconEl.setAttribute("data-mode", "default");
    iconEl.style.backgroundColor = bgColor;
    iconEl.textContent = getDisplayNameAbbr(name);
  }
}

/**
 * 挨拶メッセージを Tauri の greet で取得し、表示要素に反映する。
 * @returns Promise
 */
async function greet(): Promise<void> {
  if (greetMsgEl && greetInputEl) {
    greetMsgEl.textContent = await invoke("greet", {
      name: greetInputEl.value,
    });
  }
}

/**
 * ホーム画面の初期化を行う。「home」ビュー表示時のハンドラ登録と挨拶フォームのイベント登録を行う。
 * @returns なし
 */
export function initHomeScreen(): void {
  registerViewHandler("home", () => {
    renderHeaderProfile();
  });

  greetInputEl = document.querySelector("#greet-input");
  greetMsgEl = document.querySelector("#greet-msg");
  document.querySelector("#greet-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    greet();
  });
}
