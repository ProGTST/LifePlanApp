# 勘定項目画面 仕様書

## 1. 画面基本情報

| 項目 | 内容 |
|------|------|
| 画面ID | account |
| 画面名 | 勘定項目 |
| URL | N/A（SPA。ビューID: `account`） |
| 対象ユーザー | ログイン済みの一般ユーザー。自分の勘定の編集、参照権限の付与・編集が可能。 |
| 関連画面 | **遷移元**: サイドバー「勘定項目」。**遷移先**: 他画面。収支記録・収支履歴で勘定を選択する際のマスタ。 |

---

## 2. 画面概要

- **目的**: 現金・口座・カードなど、収支の発生元・発生先を表す勘定項目（ACCOUNT）を登録・編集・削除し、他ユーザーへの参照権限（ACCOUNT_PERMISSION）を管理する。
- **業務上の位置付け**: 勘定マスタの一覧・追加・更新・削除画面。権限付与により「参照可能な勘定」として他ユーザー所有の勘定を一覧表示する。
- **想定利用シナリオ**: 自分の勘定を追加し、家族に「参照」または「編集」権限を付与して共有する。一覧で名前・色・アイコンを直接編集し、ドラッグで並び順を変更する。

---

## 3. UI構成

### 3.1 画面レイアウト

| エリア | 内容 |
|--------|------|
| ヘッダー | タイトル「勘定項目」、データ最新化、追加ボタン、削除モード切替ボタン |
| 検索エリア | なし |
| 一覧エリア | **自分の勘定**: account-table（ドラッグ、アイコン、勘定項目名、残高、権限、削除）。**参照可能な勘定**: account-shared-table（アイコン、勘定項目名、残高、ユーザー、権限種別） |
| 詳細エリア | 追加時のみモーダル（勘定項目名、色・アイコン、権限ユーザー一覧、権限追加）。既存勘定の権限管理は別モーダル（権限ユーザー一覧、参照/編集切替、削除） |
| フッター | 戻るボタン |

### 3.2 入力項目定義（追加モーダル）

| 項目名 | DB項目 | 型 | 必須 | 制約 | 備考 |
|--------|--------|-----|------|------|------|
| 勘定項目名 | ACCOUNT.ACCOUNT_NAME | 文字列 | ○ | maxlength 100 | プレースホルダー「勘定項目名を入力」 |
| 色 | ACCOUNT.COLOR | 文字列 | — | #rrggbb 推奨 | カラーピッカーで設定 |
| アイコンパス | ACCOUNT.ICON_PATH | 文字列 | — | — | ピッカーで選択。hidden で保持 |
| 権限ユーザー | ACCOUNT_PERMISSION.USER_ID, PERMISSION_TYPE | — | — | — | 複数可。view / edit。フォーム送信時に新規 ACCOUNT_PERMISSION 行として追加 |

一覧行: 勘定項目名（contentEditable）、アイコン（クリックで色・アイコン変更）、残高（表示のみ）、権限（件数表示＋「権限追加」）、削除（削除モード時のみ表示）。

---

## 4. 操作仕様（イベント仕様）

| 操作 | 条件 | 処理内容 | 備考 |
|------|------|----------|------|
| 追加ボタン | — | モーダルを開く。フォームを初期化（名前空、色デフォルト、権限リスト空） | |
| モーダル 登録 | 勘定項目名が空でない | 新規 ACCOUNT 行（ID=最大+1, USER_ID=currentUserId, SORT_ORDER=最大+1）を追加。権限指定があれば新規 ACCOUNT_PERMISSION 行を追加。saveAccountCsvOnly（ACCOUNT.csv + ACCOUNT_PERMISSION.csv）→ モーダル閉じ、一覧再描画 | |
| 勘定名セル編集（blur 等） | 変更あり | 空なら deleteAccountRow。変更があれば saveAccountNameFromCell（バージョンチェック → ACCOUNT.ACCOUNT_NAME 更新 → persistAccount） | |
| アイコンクリック | — | カラーピッカーで色・アイコン変更。バージョンチェック → ACCOUNT.COLOR, ICON_PATH 更新 → persistAccount | |
| ドラッグ並び替え | 自分の勘定一覧内 | moveAccountOrder: SORT_ORDER を再採番 → persistAccount | |
| 権限追加（一覧） | — | 権限ユーザー管理モーダルを開く。モーダル内「権限追加」→ ユーザー選択 → 適用で ACCOUNT_PERMISSION に追加または既存とマージ。saveAccountCsvOnly | |
| 権限 参照/編集切替・削除 | — | 該当 ACCOUNT_PERMISSION 行を更新または削除。バージョンチェック後 saveAccountCsvOnly | |
| 削除モード切替 | — | 削除ボタンの表示/非表示をトグル | |
| 行削除 | 削除モード ON、自分の勘定 | deleteAccountRow: 該当 ACCOUNT 行を削除、当該 ACCOUNT_ID の ACCOUNT_PERMISSION を全削除 → saveAccountCsvOnly | |

---

## 5. 業務ルール

- **自分の勘定のみ編集・削除可能**: USER_ID === currentUserId の行のみ一覧で編集・並び替え・削除できる。参照可能な勘定（他ユーザー所有）は表示のみ。
- **新規追加は自分の勘定のみ**: 追加モーダルで登録する勘定は必ず USER_ID = currentUserId。権限ユーザーを指定すると、そのユーザー向けに ACCOUNT_PERMISSION を新規作成する。
- **削除時は当該勘定の権限をすべて削除**: ACCOUNT 行削除時、ACCOUNT_PERMISSION の当該 ACCOUNT_ID をすべて削除してから保存する。
- **楽観的ロック**: ACCOUNT / ACCOUNT_PERMISSION の更新・削除前に VERSION をチェック。不一致時はアラート後に再取得・再描画。
- **表示順**: 自分の勘定は SORT_ORDER 昇順。参照可能な勘定はユーザー順のうえ SORT_ORDER。

---

## 6. データ連携

### 6.1 API仕様

| メソッド | パス | 概要 |
|----------|------|------|
| GET | /api/data/ACCOUNT.csv | 勘定一覧取得 |
| GET | /api/data/ACCOUNT_PERMISSION.csv | 権限一覧取得（cache: reload） |
| GET | /api/data/USER.csv | 権限ユーザー名表示用 |
| POST | /api/data/ACCOUNT.csv | 勘定 CSV 保存（行あり時のみ。空の場合は書き出さない） |
| POST | /api/data/ACCOUNT_PERMISSION.csv | 権限 CSV 保存（常に書き出す） |

### 6.2 DB定義（CSV 対応）

| 種別 | テーブル（ファイル） | 備考 |
|------|----------------------|------|
| 使用テーブル | ACCOUNT, ACCOUNT_PERMISSION | 一覧・権限管理 |
| 参照テーブル | ACCOUNT, ACCOUNT_PERMISSION, USER | 表示名用に USER 参照 |
| 更新対象 | ACCOUNT, ACCOUNT_PERMISSION | 追加・更新・削除時は saveAccountCsvOnly で両方保存 |

---

## 7. 権限制御

- **勘定ごとの参照制御**: ACCOUNT_PERMISSION で「どのユーザーがどの勘定を参照/編集できるか」を管理。PERMISSION_TYPE は `view`（参照）または `edit`（編集）。一覧の「参照可能な勘定」は、他ユーザー所有で自分に権限が付与されている勘定のみ表示。
- **編集可能なのは自分の勘定のみ**: 他ユーザー勘定は参照のみ（収支記録・収支履歴では選択可能だが、勘定項目画面では名前・色の編集・削除は不可）。

---

## 8. バリデーション仕様

| 種別 | 内容 |
|------|------|
| 必須チェック | 勘定項目名: 追加時は空不可。一覧で空にした場合は削除扱い |
| 桁数チェック | 勘定項目名: maxlength 100 |

---

## 9. エラー仕様

| 項目 | 内容 |
|------|------|
| 表示位置 | バージョン競合: alert。API 失敗: saveAccountCsvOnly の catch で console.error |
| メッセージ内容 | getVersionConflictMessage と同様 |
| HTTP ステータス | POST が 200 以外のとき saveCsvViaApi が throw |

---

## 10. 非機能要件

| 項目 | 内容 |
|------|------|
| レスポンス目標 | 特になし |
| 同時接続数想定 | 特になし |
| ログ出力内容 | saveAccountCsvOnly 失敗時など console.error |
