import "./styles/login.css";
import { USER_ID_STORAGE_KEY, APP_PAGE_PATH } from "./constants/index";
import { fetchUserIds } from "./screens/login-screen";

function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
}

function initLoginPage(): void {
  if (isTauri()) {
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      await appWindow.center();
      await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        await appWindow.destroy();
      });
    });
  }
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

    sessionStorage.setItem(USER_ID_STORAGE_KEY, userId);
    window.location.href = APP_PAGE_PATH;
  });
}

window.addEventListener("DOMContentLoaded", initLoginPage);
