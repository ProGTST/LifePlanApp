/**
 * システム画面の初期化。物理削除・月別集計ボタンのイベント登録を行う。
 */
import { registerViewHandler } from "../app/screen";
import { runMonthlyAggregation } from "../utils/transactionMonthlyAggregate";
import { runPhysicalDelete } from "../utils/physicalDelete";

export function initSystemView(): void {
  registerViewHandler("system", () => {});

  document.getElementById("system-physical-delete-btn")?.addEventListener("click", async () => {
    if (!confirm("論理削除された取引データをファイルから完全に削除します。よろしいですか？")) return;
    const btn = document.getElementById("system-physical-delete-btn") as HTMLButtonElement;
    const msgEl = document.getElementById("system-view-message");
    if (btn) btn.disabled = true;
    if (msgEl) msgEl.textContent = "";
    try {
      const result = await runPhysicalDelete();
      if (msgEl) {
        msgEl.textContent = `物理削除しました。削除件数：${result.deletedCount}`;
      }
    } catch (e) {
      if (msgEl) {
        msgEl.textContent = `エラー: ${e instanceof Error ? e.message : String(e)}`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

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
