/**
 * システム画面の初期化。物理削除・勘定集計・月別集計ボタンのイベント登録を行う。
 */
import { registerViewHandler } from "../app/screen";
import { runMonthlyAggregation } from "../utils/transactionMonthlyAggregate";
import { runPhysicalDelete } from "../utils/physicalDelete";
import { runAccountBalanceRecalculate } from "../utils/accountBalanceRecalculate";
import { VersionConflictError } from "../utils/dataApi";

function alertError(e: unknown): void {
  if (e instanceof VersionConflictError) {
    alert(e.message);
    return;
  }
  alert(`エラー: ${e instanceof Error ? e.message : String(e)}`);
}

export function initSystemView(): void {
  registerViewHandler("system", () => {});

  document.getElementById("system-physical-delete-btn")?.addEventListener("click", async () => {
    if (!confirm("論理削除された取引データをファイルから完全に削除します。よろしいですか？")) return;
    const btn = document.getElementById("system-physical-delete-btn") as HTMLButtonElement;
    if (btn) btn.disabled = true;
    try {
      const result = await runPhysicalDelete();
      alert(`物理削除しました。削除件数：${result.deletedCount}`);
    } catch (e) {
      alertError(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("system-account-aggregate-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("system-account-aggregate-btn") as HTMLButtonElement;
    if (btn) btn.disabled = true;
    try {
      const result = await runAccountBalanceRecalculate();
      alert(`勘定集計しました。実績取引：${result.transactionCount}件、更新勘定：${result.accountCount}件`);
    } catch (e) {
      alertError(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("system-monthly-aggregate-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("system-monthly-aggregate-btn") as HTMLButtonElement;
    if (btn) btn.disabled = true;
    try {
      const result = await runMonthlyAggregation();
      alert(`集計しました。集計対象：${result.eligibleCount} 集計結果：${result.resultCount}`);
    } catch (e) {
      alertError(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
