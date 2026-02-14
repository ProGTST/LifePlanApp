# データ CSV ファイル仕様

LifePlanGant で扱う収支・タグ・勘定項目のデータは、`data/` フォルダ内の CSV ファイルで管理します。  
いずれも **1行目はヘッダー**、2行目以降がデータです。文字コードは **UTF-8** を想定しています。

**全テーブル共通の監査項目**（ID の直後に配置）  
- **REGIST_DATETIME** … 登録日時（YYYY-MM-DD HH:MM:SS 推奨）  
- **REGIST_USER** … 登録ユーザーID（USER.ID への参照）  
- **UPDATE_DATETIME** … 更新日時  
- **UPDATE_USER** … 更新ユーザーID（USER.ID への参照）

---

## 1. ユーザーテーブル（USER）

**ファイル**: `data/USER.csv`

アプリを利用するユーザーのマスタです。REGIST_USER / UPDATE_USER の参照先になります。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | ユーザーの一意識別子 | ログイン等に使う一意の文字列（例: coara） |
| REGIST_DATETIME | 登録日時 | 全テーブル共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 全テーブル共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| NAME | ユーザー名 | 表示名 |
| COLOR | プロフィール用の色 | 例: #f09a9f。任意 |
| ICON_PATH | アイコン画像のパス | 任意。ファイルパスまたはURL（例: /icon/profile/xxx.png） |

---

## 2. タグテーブル（TAG）

**ファイル**: `data/TAG.csv`

収支に付与するタグのマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | タグの一意識別子 | 数値。他テーブルから参照される |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TAG_NAME | タグの表示名 | 例: 食費, 交通費, 娯楽 |
| COLOR | 色 | 例: #ff0000 やカラーコード。任意。一覧・ピッカーで変更可 |
| ICON_PATH | アイコンパス | 例: /icon/custom/xxx.svg。任意。一覧・ピッカーで変更可 |
| SORT_ORDER | 表示順 | 同テーブル内の並び順（数値）。ドラッグで変更可 |

---

## 3. タグ管理テーブル（TAG_MANAGEMENT）

**ファイル**: `data/TAG_MANAGEMENT.csv`

「どの収支（TRANSACTION）にどのタグ（TAG）が付いているか」を表す中間テーブルです。  
1件の収支に複数タグを付けられます。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TRANSACTION_ID | 収支ID | TRANSACTION.ID への参照 |
| TAG_ID | タグID | TAG.ID への参照 |

---

## 4. カテゴリテーブル（CATEGORY）

**ファイル**: `data/CATEGORY.csv`

収支の分類（費目・収入の種類）を表すマスタです。階層構造を持てます（PARENT_ID で親を指定）。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | カテゴリの一意識別子 | 数値。TRANSACTION.CATEGORY_ID から参照 |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| PARENT_ID | 親カテゴリID | 空欄または null で最上位。CATEGORY.ID への参照 |
| TYPE | 収支種別 | `income`（収入） / `expense`（支出） / `transfer`（振替） |
| CATEGORY_NAME | カテゴリの表示名 | 例: 食費, 交通費, 給与 |
| COLOR | 色 | 例: #ff0000 やカラーコード。任意。一覧・ピッカーで変更可 |
| ICON_PATH | アイコンパス | 例: /icon/custom/xxx.svg。任意。一覧・ピッカーで変更可 |
| SORT_ORDER | 表示順 | 同種別内の並び順（数値）。ドラッグで変更可 |

---

## 5. 収支テーブル（TRANSACTION）

**ファイル**: `data/TRANSACTION.csv`

収入・支出の計画および実績を表すテーブルです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 収支の一意識別子 | 数値 |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TYPE | 収支種別 | `income`（収入） / `expense`（支出） / `transfer`（振替） |
| STATUS | 計画 | `plan`（予定） / `actual`（実績） |
| CATEGORY_ID | カテゴリID | CATEGORY.ID への参照 |
| NAME | 項目名 | 例: 給与, スーパー買い物 |
| ACTUAL_DATE | 実績日 | 日付（YYYY-MM-DD）。実績と計画で使用。予定の場合は計画の開始日と同一日を設定 |
| PLAN_DATE_FROM | 計画の開始日 | 日付（YYYY-MM-DD）。実績と計画で使用。実績の場合は実績日と同一日を設定 |
| PLAN_DATE_TO | 計画の終了日 | 日付（YYYY-MM-DD）。実績と計画で使用。実績の場合は実績日と同一日を設定 |
| AMOUNT | 金額 | 数値（円など単位はアプリ側で統一） |
| MEMO | メモ | 任意 |
| ACCOUNT_ID_IN | 勘定項目ID（収入、振替） | ACCOUNT.ID への参照。収益や振替の入金先を指定 |
| ACCOUNT_ID_OUT | 勘定項目ID（支出、振替） | ACCOUNT.ID への参照。費用や振替の出金元を指定。 |

---

## 6. 勘定項目テーブル（ACCOUNT）

**ファイル**: `data/ACCOUNT.csv`

現金・口座・カードなど、収支の発生元・発生先を表すマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 勘定項目の一意識別子 | 数値。TRANSACTION.ACCOUNT_ID_IN / ACCOUNT_ID_OUT から参照 |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| USER_ID | ユーザーID | USER.ID への参照。ユーザーごとに勘定項目を管理 |
| ACCOUNT_NAME | 勘定項目名 | 例: 現金, 銀行口座, クレジットカード |
| COLOR | 色 | 例: #ff0000 やカラーコード。任意。一覧・ピッカーで変更可 |
| ICON_PATH | アイコンパス | 例: /icon/custom/xxx.svg。任意。一覧・ピッカーで変更可 |
| SORT_ORDER | 表示順 | ユーザー内の並び順（数値）。ドラッグで変更可 |

---

## 7. 勘定項目参照権限テーブル（ACCOUNT_PERMISSION）

**ファイル**: `data/ACCOUNT_PERMISSION.csv`

どのユーザーがどの勘定項目を参照・編集できるかを表すテーブルです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID |
| ACCOUNT_ID | 勘定項目ID | ACCOUNT.ID |
| USER_ID | 参照を許可するユーザーID | USER.ID |
| PERMISSION_TYPE | 権限種別 | `view`（参照） / `edit`（編集） |

---

## テーブル間の関係

```
TAG (1) ----< TAG_MANAGEMENT >---- (N) TRANSACTION
                                        |
                    +-------------------+-------------------+
                    | CATEGORY_ID       | ACCOUNT_ID_IN / ACCOUNT_ID_OUT |
                    v                   v                   |
               CATEGORY (1)        ACCOUNT (1)              |
                    ^                                        |
                    | PARENT_ID (自己参照)                   |
                    +----------------------------------------+
```

- **USER** は、全テーブルの REGIST_USER / UPDATE_USER から参照される（監査用）。
- **TRANSACTION** は **CATEGORY** に属する（多対一）。
- **TRANSACTION** は **ACCOUNT** を最大2つ参照する（ACCOUNT_ID_IN：収益側、ACCOUNT_ID_OUT：費用側。振替時は両方設定してフローを表す）。
- **TRANSACTION** と **TAG** は **TAG_MANAGEMENT** を通じて多対多。
- **CATEGORY** は PARENT_ID で親子関係を持てる（階層構造）。

---

## ファイル一覧

| ファイル | テーブル名 | 説明 |
|----------|------------|------|
| `data/USER.csv` | USER | ユーザーマスタ |
| `data/TAG.csv` | TAG | タグマスタ |
| `data/TAG_MANAGEMENT.csv` | TAG_MANAGEMENT | 収支とタグの対応 |
| `data/CATEGORY.csv` | CATEGORY | カテゴリマスタ（収入・支出の分類） |
| `data/TRANSACTION.csv` | TRANSACTION | 収支（計画・実績） |
| `data/ACCOUNT.csv` | ACCOUNT | 勘定項目マスタ |
| `data/ACCOUNT_PERMISSION.csv` | ACCOUNT_PERMISSION | 勘定項目参照権限 |
| `data/COLOR_PALETTE.csv` | COLOR_PALETTE | カラーパレット（ユーザー別色設定） |

---

## カラーパレットテーブル（COLOR_PALETTE）

**ファイル**: `data/COLOR_PALETTE.csv`

ユーザーごとに複数のパレットを登録でき、SEQ_NO で採番してパレットを選べるようにするマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| USER_ID | ユーザーID | USER.ID への参照 |
| SEQ_NO | 連番 | ユーザーごとに 1 から採番。同一ユーザー内で一意 |
| MENUBAR_BG | メニューバーの背景色 | 例: #2c2c2e |
| MENUBAR_FG | メニューバーの文字色 | 例: #fff |
| HEADER_BG | ヘッダー領域の背景色 | 例: #fff |
| HEADER_FG | ヘッダー領域の文字色 | 例: #1a1a1a |
| MAIN_BG | メインコンテンツ領域の背景色 | 例: #f0f2f5 |
| MAIN_FG | メインコンテンツ領域の文字色 | 例: #1a1a1a |
| VIEW_BG | ビュー領域（一覧・フォーム等）の背景色 | 例: #fff |
| VIEW_FG | ビュー領域の文字色 | 例: #1a1a1a |
| FOOTER_BG | フッター領域の背景色 | 例: #fff |
| FOOTER_FG | フッター領域の文字色 | 例: #666 |
| BUTTON_BG | ボタンの背景色 | 例: #646cff |
| BUTTON_FG | ボタンの文字色 | 例: #fff |
| BASE_BG | サイドバーメニュー等の背景色 | 例: #fff |
| BASE_FG | サイドバーメニュー等の文字色 | 例: #333 |
| ACCENT_BG | 強調背景色（選択中メニュー等） | 例: #646cff |
| ACCENT_FG | 強調文字色（選択中メニュー等） | 例: #fff |

※ 色は空欄の場合はアプリのデフォルトを使用。必要に応じて列を追加して管理します。

---

## public/data と Tauri 保存の関係（開発時）

- **本番**: アプリ終了時・ログアウト時に `save_master_csv` が **app_data_dir/data/** に ACCOUNT/CATEGORY/TAG を保存する。
- **開発（debug）**: 上記に加え、**データ行が含まれる場合のみ** `public/data/` にも同じ内容を書き、プロジェクト側の CSV を更新する。
- **過去の不具合**: ログアウトやウィンドウ閉じるたびに localStorage の内容で CSV を上書きしていた。localStorage が空（マスタ画面を開いていない・クリア済みなど）のときに「ヘッダーだけ」の CSV で上書きされ、**public/data の既存データが消えていた**。現在は「2行目以降があるときだけ public/data に書く」ようにして、ヘッダーだけでの上書きを防いでいる。

---

## 運用上の注意

- 新規IDは、既存の最大ID + 1 などで重複しないように付与してください。
- 日付は **YYYY-MM-DD**、日時は **YYYY-MM-DD HH:MM:SS** 形式を推奨します。
- 金額は整数または小数で統一し、単位（円など）はアプリ側で固定する想定です。
- **REGIST_USER** / **UPDATE_USER** には存在する USER.ID を設定してください。
- 参照整合性（存在しない ID を参照しない）はアプリ側でチェックすることを推奨します。
- **COLOR** は16進カラーコード（例: #646cff）を推奨。アプリの色・アイコンピッカーでプリセットまたはカスタム色を選択できます。
- **ICON_PATH** は `/icon/custom/ファイル名.svg` 形式。`public/icon/custom/` に配置した SVG は、ビルド時に `icons.json` に列挙され、ピッカーで選択できます。
