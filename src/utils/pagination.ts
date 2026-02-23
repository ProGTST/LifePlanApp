/**
 * ページネーションの共通処理。
 * 一覧の「現在ページ」「1ページあたりの件数」に基づいて表示範囲を算出する。
 */

/**
 * 総件数と1ページあたりの件数から総ページ数を返す。
 * @param totalItems - 総件数（0以上）
 * @param pageSize - 1ページあたりの件数（1以上）
 * @returns 総ページ数（1以上）
 */
export function getTotalPages(totalItems: number, pageSize: number): number {
  if (totalItems <= 0 || pageSize <= 0) return 1;
  return Math.ceil(totalItems / pageSize) || 1;
}

/**
 * 現在のページ番号を総ページ数内に収める。
 * @param page - 現在のページ番号（1始まり）
 * @param totalPages - 総ページ数
 * @returns 1 ～ totalPages の範囲のページ番号
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  if (page <= 1) return 1;
  return page > totalPages ? totalPages : page;
}

/**
 * 配列から指定ページのスライスを返す。
 * @param items - 元の配列
 * @param page - ページ番号（1始まり）
 * @param pageSize - 1ページあたりの件数
 * @returns そのページに表示する要素の配列
 */
export function getPageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  if (items.length === 0 || pageSize <= 0) return [];
  const totalPages = getTotalPages(items.length, pageSize);
  const safePage = clampPage(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  return items.slice(start, end);
}

/**
 * ページネーションの表示用情報を返す。
 * @param totalItems - 総件数
 * @param page - 現在のページ（1始まり）
 * @param pageSize - 1ページあたりの件数
 * @returns 表示開始・終了件数（1始まり）と総ページ数
 */
export function getPaginationInfo(
  totalItems: number,
  page: number,
  pageSize: number
): { startItem: number; endItem: number; totalPages: number } {
  const totalPages = getTotalPages(totalItems, pageSize);
  const safePage = clampPage(page, totalPages);
  if (totalItems === 0) {
    return { startItem: 0, endItem: 0, totalPages: 1 };
  }
  const startItem = (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);
  return { startItem, endItem, totalPages };
}

/** renderPagination のオプション */
export interface RenderPaginationOptions {
  /** 総件数 */
  totalItems: number;
  /** 現在のページ（1始まり） */
  page: number;
  /** 1ページあたりの件数 */
  pageSize: number;
  /** 件数表示を描画する要素のID（省略時は更新しない） */
  infoTopId?: string | null;
  /** 前へ・次へボタンなどを描画するコンテナ要素のID */
  wrapId: string;
  /** 前のページへ遷移したときのコールバック */
  onPrevPage: () => void;
  /** 次のページへ遷移したときのコールバック */
  onNextPage: () => void;
  /** 前へボタンのクラス（省略時は "btn-secondary"） */
  prevBtnClass?: string;
  /** 次へボタンのクラス（省略時は "btn-secondary"） */
  nextBtnClass?: string;
  /** ページ情報（○/○ページ）のクラス（省略時は "transaction-history-pagination-page-info" 相当の汎用名） */
  pageInfoClass?: string;
}

/**
 * ページネーションUI（件数表示・前へ・次へ）を描画する共通処理。
 * 遷移先がない場合も前へ・次へボタンは表示し、無効化してグレー背景で表示する。
 */
export function renderPagination(options: RenderPaginationOptions): void {
  const {
    totalItems,
    page,
    pageSize,
    infoTopId,
    wrapId,
    onPrevPage,
    onNextPage,
    prevBtnClass = "btn-secondary",
    nextBtnClass = "btn-secondary",
    pageInfoClass = "pagination-page-info",
  } = options;

  const infoTop = infoTopId ? document.getElementById(infoTopId) : null;
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  const totalPages = getTotalPages(totalItems, pageSize);
  const rangeText =
    totalItems === 0
      ? "0件"
      : (() => {
          const { startItem, endItem } = getPaginationInfo(totalItems, page, pageSize);
          return `${startItem}-${endItem} / ${totalItems}件`;
        })();

  if (infoTop) {
    infoTop.textContent = rangeText;
  }

  wrap.innerHTML = "";
  if (totalItems === 0) {
    return;
  }

  const hasPrev = page > 1;
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = prevBtnClass + (hasPrev ? "" : " pagination-btn--disabled");
  prevBtn.textContent = "前へ";
  prevBtn.setAttribute("aria-label", "前のページ");
  prevBtn.disabled = !hasPrev;
  if (hasPrev) prevBtn.addEventListener("click", onPrevPage);
  wrap.appendChild(prevBtn);

  if (totalPages > 1) {
    const pageInfo = document.createElement("span");
    pageInfo.className = pageInfoClass;
    pageInfo.textContent = `${page} / ${totalPages}ページ`;
    wrap.appendChild(pageInfo);
  }

  const hasNext = page < totalPages;
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = nextBtnClass + (hasNext ? "" : " pagination-btn--disabled");
  nextBtn.textContent = "次へ";
  nextBtn.setAttribute("aria-label", "次のページ");
  nextBtn.disabled = !hasNext;
  if (hasNext) nextBtn.addEventListener("click", onNextPage);
  wrap.appendChild(nextBtn);
}
