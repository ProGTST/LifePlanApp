/**
 * システム画面の初期化。月別集計ボタンのイベント登録を行う。
 */
import { registerViewHandler } from "../app/screen";
import { runMonthlyAggregation } from "../utils/transactionMonthlyAggregate";

export function initSystemView(): void {
  registerViewHandler("system", () => {});

  document.getElementById("system-monthly-aggregate-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("system-monthly-aggregate-btn") as HTMLButtonElement;
    const msgEl = document.getElementById("system-view-message");
    if (btn) btn.disabled = true;
    if (msgEl) msgEl.textContent = "";
    try {
      const result = await runMonthlyAggregation();
      if (msgEl) {
        msgEl.textContent = `集計しました。集計対象：${result.eligibleCount} 集計結果：${result.resultCount}`;
      }
    } catch (e) {
      if (msgEl) {
        msgEl.textContent = `エラー: ${e instanceof Error ? e.message : String(e)}`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
