# デザイン画面 仕様書

## 1. 画面基本情報

| 項目 | 内容 |
|------|------|
| 画面ID | design |
| 画面名 | デザイン |
| URL | N/A（SPA。ビューID: `design`） |
| 対象ユーザー | ログイン済みの一般ユーザー（自分用の配色を編集） |
| 関連画面 | **遷移元**: サイドバー「設定」→「デザイン」。**遷移先**: 他画面へ。離脱時に `saveColorPaletteCsvOnNavigate` で COLOR_PALETTE.csv を保存。 |

---

## 2. 画面概要

- **目的**: アプリ全体の配色（メニューバー・ヘッダー・メイン・ビュー・フッター・ボタン・ベース・強調）をユーザーごとに設定する。
- **業務上の位置付け**: カラーパレット（COLOR_PALETTE）のマスタ編集画面。CSS 変数（--color-*）を通じて即時反映される。
- **想定利用シナリオ**: ダークモード風にしたい、アクセント色を変えたいなど、見た目を個人設定する。

---

## 3. UI構成

### 3.1 画面レイアウト

| エリア | 内容 |
|--------|------|
| ヘッダー | タイトル「デザイン」、データ最新化、保存ボタン、デフォルトに戻すボタン |
| 検索エリア | なし |
| 一覧エリア | なし |
| 詳細エリア | デザインフォーム（design-form-fields）。各パレットキーごとにラベル・color 入力・hex 入力・スウォッチ。右側に配色プレビュー（design-preview-wrap） |
| フッター | 戻るボタン |

### 3.2 入力項目定義

| 項目名 | DB項目 | 型 | 必須 | 制約 | 備考 |
|--------|--------|-----|------|------|------|
| メニューバー背景 | COLOR_PALETTE.MENUBAR_BG | 文字列 | — | #rrggbb 推奨 | 3桁 #fff は 6桁に展開 |
| メニューバー文字色 | COLOR_PALETTE.MENUBAR_FG | 文字列 | — | 同上 | |
| ヘッダー背景 | COLOR_PALETTE.HEADER_BG | 文字列 | — | 同上 | |
| ヘッダー文字色 | COLOR_PALETTE.HEADER_FG | 文字列 | — | 同上 | |
| メイン背景 | COLOR_PALETTE.MAIN_BG | 文字列 | — | 同上 | |
| メイン文字色 | COLOR_PALETTE.MAIN_FG | 文字列 | — | 同上 | |
| ビュー背景 | COLOR_PALETTE.VIEW_BG | 文字列 | — | 同上 | |
| ビュー文字色 | COLOR_PALETTE.VIEW_FG | 文字列 | — | 同上 | |
| フッター背景 | COLOR_PALETTE.FOOTER_BG | 文字列 | — | 同上 | |
| フッター文字色 | COLOR_PALETTE.FOOTER_FG | 文字列 | — | 同上 | |
| ボタン背景 | COLOR_PALETTE.BUTTON_BG | 文字列 | — | 同上 | |
| ボタン文字色 | COLOR_PALETTE.BUTTON_FG | 文字列 | — | 同上 | |
| ベース背景 | COLOR_PALETTE.BASE_BG | 文字列 | — | 同上 | |
| ベース文字色 | COLOR_PALETTE.BASE_FG | 文字列 | — | 同上 | |
| 強調背景 | COLOR_PALETTE.ACCENT_BG | 文字列 | — | 同上 | |
| 強調文字色 | COLOR_PALETTE.ACCENT_FG | 文字列 | — | 同上 | |

※ キーは PALETTE_KEYS で定義。無効値は各キーごとの DEFAULT_PALETTE にフォールバック。

---

## 4. 操作仕様（イベント仕様）

| 操作 | 条件 | 処理内容 | 備考 |
|------|------|----------|------|
| 保存ボタン押下 / フォーム submit | バージョン一致 | フォームの各色を現在ユーザーのパレット行に反映 → バージョンチェック（USER_ID+SEQ_NO）→ setColorPalette(userId) で localStorage に保存 → COLOR_PALETTE.csv を API 保存 → #app に CSS 変数を設定して即時反映 → clearColorPaletteDirty | |
| デフォルトに戻す | — | 全キーを DEFAULT_PALETTE に設定 → フォーム・プレビュー・#app を更新 → saveDesignForm で保存 | |
| スウォッチ クリック/Enter/Space | — | 該当キーのカラーピッカーを開く。選択色を color/hex に反映し、dirty フラグ、プレビュー更新 | |
| hex 入力 | 有効な #rrggbb | color 入力・スウォッチを同期し、dirty フラグ、プレビュー更新 | |
| 画面離脱 | — | saveColorPaletteCsvOnNavigate でフォーム内容をパレットに反映し COLOR_PALETTE.csv を保存 | |

---

## 5. 業務ルール

- **1ユーザー1パレット**: USER_ID が currentUserId の行を1件使用。存在しなければメモリ上で新規作成（SEQ_NO=1、デフォルト色）してフォームに表示する。
- **localStorage 優先**: loadAndRenderDesign 時に getColorPalette(currentUserId) があれば、その値でパレット行を上書きしてフォームに反映する。
- **保存時は CSV と localStorage の両方**: COLOR_PALETTE.csv を API で保存するとともに、setColorPalette(currentUserId, toStore) で localStorage に保存する。
- **即時反映**: 保存後、#app の style に PALETTE_KEYS に対応する CSS 変数を設定し、画面全体の色を即時変更する。
- **楽観ロック**: COLOR_PALETTE は USER_ID + SEQ_NO をキーにバージョンチェック。不一致時はアラート後に再取得・再描画。

---

## 6. データ連携

### 6.1 API仕様

| メソッド | パス | 概要 |
|----------|------|------|
| GET | /api/data/COLOR_PALETTE.csv | パレット CSV 取得 |
| POST | /api/data/COLOR_PALETTE.csv | パレット CSV 全文保存。body: `{ csv }` |

### 6.2 DB定義（CSV 対応）

| 種別 | テーブル（ファイル） | 備考 |
|------|----------------------|------|
| 使用テーブル | COLOR_PALETTE | USER_ID, SEQ_NO で現在ユーザー行を特定 |
| 参照テーブル | COLOR_PALETTE | 同上。＋ localStorage（getColorPalette） |
| 更新対象 | COLOR_PALETTE | 該当行の各色キー・監査・VERSION。未存在時は新規行を追加してから CSV 全体を保存 |

---

## 7. 権限制御

- ログイン済みユーザーのみ表示。**自分用のパレット（USER_ID = currentUserId）のみ編集**。他ユーザーのパレット行は触らない。

---

## 8. バリデーション仕様

| 種別 | 内容 |
|------|------|
| 形式チェック | 色は #rrggbb または #rgb。無効時は DEFAULT_PALETTE[key] にフォールバック（toValidHex） |

---

## 9. エラー仕様

| 項目 | 内容 |
|------|------|
| 表示位置 | バージョン競合時: alert |
| メッセージ内容 | csvVersionCheck の getVersionConflictMessage と同様 |
| HTTP ステータス | POST が 200 以外のとき saveCsvViaApi が throw |

---

## 10. 非機能要件

| 項目 | 内容 |
|------|------|
| レスポンス目標 | 特になし |
| 同時接続数想定 | 特になし |
| ログ出力内容 | 特になし |
