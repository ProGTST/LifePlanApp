import { APP_SCREEN_ID } from "../constants/index";
import { setCurrentUserId, setAccountListLoaded } from "../state";
import { applyUserPalette } from "../app/palette";
import { showScreen } from "../app/screen";
import { fetchCsv } from "../utils/csv";

/**
 * USER.csv からユーザーID一覧を取得する。ログイン画面で入力検証に利用する。
 * @returns Promise。ユーザーID の Set。取得失敗時は空の Set
 */
export async function fetchUserIds(): Promise<Set<string>> {
  const { header, rows } = await fetchCsv("/data/USER.csv");
  if (header.length < 1) return new Set();
  const idCol = header.indexOf("ID");
  if (idCol === -1) return new Set();
  const ids = new Set<string>();
  for (const cells of rows) {
    const id = cells[idCol]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * ログイン画面の初期化を行う。フォーム送信で fetchUserIds により検証し、成功時は sessionStorage にユーザーID を保存してアプリページへ遷移する。
 * @returns なし
 */
export function initLoginScreen(): void {
  const form = document.getElementById("login-form") as HTMLFormElement | null;
  const errorEl = document.getElementById("login-error");
  if (!form || !errorEl) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userInput = form.querySelector("#login-user") as HTMLInputElement;
    const userId = userInput?.value.trim() ?? "";

    errorEl.textContent = "";

    if (!userId) {
      errorEl.textContent = "ユーザーIDを入力してください。";
      return;
    }

    const userIds = await fetchUserIds();
    if (!userIds.has(userId)) {
      errorEl.textContent = "ユーザーが見つかりません。";
      return;
    }

    await applyUserPalette(userId);
    setCurrentUserId(userId);
    setAccountListLoaded(false);
    showScreen(APP_SCREEN_ID);
  });
}
