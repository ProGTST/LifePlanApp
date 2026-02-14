import { DEFAULT_VIEW } from "./constants/index";
import type { AccountRow, CategoryRow, TagRow, TransactionRow, TagManagementRow } from "./types.ts";

/** ログイン中のユーザーID */
export let currentUserId = "";

export function setCurrentUserId(id: string): void {
  currentUserId = id;
}

/** 現在表示中のメインビューID */
export let currentView: string = DEFAULT_VIEW;

/**
 * メニュー遷移のスタック（ホームから現在までの経路）。
 * ホームに遷移 or 戻るでホームに着いたら ["home"] にリセット。
 * 戻る押下時は遷移先をスタックに積まない（pop のみ）。
 */
export let viewStack: string[] = [DEFAULT_VIEW];

export function setCurrentView(view: string): void {
  if (view !== currentView) currentView = view;
}

/** メニューから画面遷移したときに呼ぶ。ホームならスタックリセット、それ以外は push */
export function pushNavigation(view: string): void {
  if (view === DEFAULT_VIEW) {
    viewStack = [DEFAULT_VIEW];
  } else {
    viewStack = [...viewStack, view];
  }
  currentView = view;
}

/** 戻る押下時に呼ぶ。戻り先のビューを返す（戻れない場合は null）。スタックは pop 済み。 */
export function popNavigation(): string | null {
  if (viewStack.length <= 1) return null;
  const target = viewStack[viewStack.length - 2];
  viewStack = viewStack.slice(0, -1);
  currentView = target;
  return target;
}

/** サイドバーで開いているパネル（menu | settings） */
export let sidebarOpenPanel: string | null = null;

export function setSidebarOpenPanel(panel: string | null): void {
  sidebarOpenPanel = panel;
}

/** 勘定項目：全件キャッシュ */
export let accountListFull: AccountRow[] = [];

export function setAccountListFull(list: AccountRow[]): void {
  accountListFull = list;
}

/** 勘定項目：表示用（現在ユーザーでフィルタ済み） */
export let accountList: AccountRow[] = [];

export function setAccountList(list: AccountRow[]): void {
  accountList = list;
}

/** 勘定項目をCSVから読み込み済みか */
export let accountListLoaded = false;

export function setAccountListLoaded(loaded: boolean): void {
  accountListLoaded = loaded;
}

/** 勘定項目：削除モードON/OFF */
export let accountDeleteMode = false;

export function setAccountDeleteMode(on: boolean): void {
  accountDeleteMode = on;
}

export function toggleAccountDeleteMode(): boolean {
  accountDeleteMode = !accountDeleteMode;
  return accountDeleteMode;
}

/** カテゴリー：全件キャッシュ */
export let categoryListFull: CategoryRow[] = [];
export function setCategoryListFull(list: CategoryRow[]): void {
  categoryListFull = list;
}
export let categoryList: CategoryRow[] = [];
export function setCategoryList(list: CategoryRow[]): void {
  categoryList = list;
}
export let categoryListLoaded = false;
export function setCategoryListLoaded(loaded: boolean): void {
  categoryListLoaded = loaded;
}
export let categoryDeleteMode = false;
export function setCategoryDeleteMode(on: boolean): void {
  categoryDeleteMode = on;
}
export function toggleCategoryDeleteMode(): boolean {
  categoryDeleteMode = !categoryDeleteMode;
  return categoryDeleteMode;
}

/** タグ：全件キャッシュ */
export let tagListFull: TagRow[] = [];
export function setTagListFull(list: TagRow[]): void {
  tagListFull = list;
}
export let tagList: TagRow[] = [];
export function setTagList(list: TagRow[]): void {
  tagList = list;
}
export let tagListLoaded = false;
export function setTagListLoaded(loaded: boolean): void {
  tagListLoaded = loaded;
}
export let tagDeleteMode = false;
export function setTagDeleteMode(on: boolean): void {
  tagDeleteMode = on;
}
export function toggleTagDeleteMode(): boolean {
  tagDeleteMode = !tagDeleteMode;
  return tagDeleteMode;
}

/** 収支：一覧用（検索・表示で使用） */
export let transactionList: TransactionRow[] = [];
export function setTransactionList(list: TransactionRow[]): void {
  transactionList = list;
}

/** タグ管理：収支とタグの対応（収支履歴のタグ検索で使用） */
export let tagManagementList: TagManagementRow[] = [];
export function setTagManagementList(list: TagManagementRow[]): void {
  tagManagementList = list;
}
