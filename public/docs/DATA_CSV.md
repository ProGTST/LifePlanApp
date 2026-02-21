# データ CSV ファイル仕様

LifePlanGant で扱う収支・タグ・勘定項目のデータは、`data/` フォルダ内の CSV ファイルで管理します。  
いずれも **1行目はヘッダー**、2行目以降がデータです。文字コードは **UTF-8** を想定しています。

---

## 全テーブル共通

- **VERSION** … 楽観的ロック用。初期値は `0`。データ更新のたびに 1 増やす。取得時に CSV から読み取り、更新・削除前に CSV の対象行の最新 VERSION と比較する。
- **監査項目**（VERSION の次に配置。COLOR_PALETTE のみ VERSION の次に以下 4 列を追加）
  - **REGIST_DATETIME** … 登録日時（YYYY-MM-DD HH:MM:SS 推奨）
  - **REGIST_USER** … 登録ユーザーID（USER.ID への参照）
  - **UPDATE_DATETIME** … 更新日時
  - **UPDATE_USER** … 更新ユーザーID（USER.ID への参照）

**更新・削除時のバージョンチェック**
- 更新または削除実行前に、対象データだけ CSV から最新を取得し、編集中の VERSION と比較する。
- 最新の VERSION と異なる場合: 「他のユーザーが更新しました。最新のデータを取得するので、確認してください。」と表示し、最新データを取得して画面に再表示する。
- 対象データが CSV に存在しない場合: 「他のユーザーが更新しました。該当のデータはありません。」と表示し、最新データを取得して画面に再表示する。

---

## ID 採番ルール

- **新規 ID**: 当該テーブル内の既存行の ID の最大値 + 1 で付与する（数値の場合は数値比較、文字列の場合は USER.ID など仕様に従う）。
- **削除された ID は再利用しない**。論理削除（DLT_FLG=1）した行の ID も、物理削除した行の ID も再利用しない。これにより履歴・参照の一意性を保つ。
- **並行登録**: CSV 運用では同時に複数クライアントが同一テーブルに新規行を追加した場合、最大 ID + 1 の計算が競合し得る。アプリ側では保存前に再取得して最大 ID を確定するなど、重複しないようにする。将来 SQLite に移行する場合は、ID を `INTEGER PRIMARY KEY`（または AUTOINCREMENT）相当で管理すると移行が容易である。

---

## 論理削除（DLT_FLG）の扱い

- **TRANSACTION** には **DLT_FLG** がある。`0`＝有効、`1`＝削除扱い。取引の「削除」は物理削除せず DLT_FLG を `1` にする。
- **通常の検索・一覧・集計は DLT_FLG = 0 の行のみを対象とする**。アプリ側の取得処理で `(DLT_FLG || "0") !== "1"` により除外する。
- **ACCOUNT_HISTORY**: 取引削除時も、当該取引に紐づく履歴レコードは削除せず残す（TRANSACTION_STATUS = `delete` のレコードとして残すか、または履歴として参照のみに使う）。残高の巻き戻しは ACCOUNT.BALANCE と ACCOUNT_HISTORY の整合性ポリシーに従う。

---

## ファイル一覧

| ファイル | テーブル名 | 説明 |
|----------|------------|------|
| `data/COLOR_PALETTE.csv` | COLOR_PALETTE | カラーパレット（ユーザー別色設定） |
| `data/USER.csv` | USER | ユーザーマスタ |
| `data/ACCOUNT.csv` | ACCOUNT | 勘定項目マスタ |
| `data/ACCOUNT_PERMISSION.csv` | ACCOUNT_PERMISSION | 勘定項目参照権限 |
| `data/ACCOUNT_HISTORY.csv` | ACCOUNT_HISTORY | 勘定項目履歴 |
| `data/CATEGORY.csv` | CATEGORY | カテゴリマスタ（収入・支出の分類） |
| `data/TAG.csv` | TAG | タグマスタ |
| `data/TAG_MANAGEMENT.csv` | TAG_MANAGEMENT | 収支とタグの対応 |
| `data/TRANSACTION.csv` | TRANSACTION | 収支（計画・実績） |
| `data/TRANSACTION_MANAGEMENT.csv` | TRANSACTION_MANAGEMENT | 取引予定と取引実績の紐付け |
| `data/TRANSACTION_MONTHLY.csv` | TRANSACTION_MONTHLY | 取引データの月別集計 |

---

## カラーパレットテーブル（COLOR_PALETTE）

**ファイル**: `data/COLOR_PALETTE.csv`

ユーザーごとに複数のパレットを登録でき、SEQ_NO で採番してパレットを選べるようにするマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| USER_ID | ユーザーID | USER.ID への参照 |
| SEQ_NO | 連番 | ユーザーごとに 1 から採番。同一ユーザー内で一意 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
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

**一意制約**
- **(USER_ID, SEQ_NO)** は一意。同一ユーザー内で SEQ_NO が重複しない。ユーザーごとに複数パレットを持てるが、SEQ_NO で区別する。

※ 色は空欄の場合はアプリのデフォルトを使用。必要に応じて列を追加して管理します。

---

## 1. ユーザーテーブル（USER）

**ファイル**: `data/USER.csv`

アプリを利用するユーザーのマスタです。REGIST_USER / UPDATE_USER の参照先になります。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | ユーザーの一意識別子 | ログイン等に使う一意の文字列（例: coara） |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 全テーブル共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 全テーブル共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| NAME | ユーザー名 | 表示名 |
| COLOR | プロフィール用の色 | 例: #f09a9f。任意 |
| ICON_PATH | アイコン画像のパス | 任意。ファイルパスまたはURL（例: /icon/profile/xxx.png） |

**一意制約**
- **ID** は一意。同一 USER 内で重複しない。

---

## 2. 勘定項目テーブル（ACCOUNT）

**ファイル**: `data/ACCOUNT.csv`

現金・口座・カードなど、収支の発生元・発生先を表すマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 勘定項目の一意識別子 | 数値。TRANSACTION.ACCOUNT_ID_IN / ACCOUNT_ID_OUT から参照 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| USER_ID | ユーザーID | USER.ID への参照。ユーザーごとに勘定項目を管理 |
| ACCOUNT_NAME | 勘定項目名 | 例: 現金, 銀行口座, クレジットカード |
| COLOR | 色 | 例: #ff0000 やカラーコード。任意。一覧・ピッカーで変更可 |
| ICON_PATH | アイコンパス | 例: /icon/custom/xxx.svg。任意。一覧・ピッカーで変更可 |
| BALANCE | 残高 | 初期値 0。数値。勘定の残高を保持 |
| SORT_ORDER | 表示順 | ユーザー内の並び順（数値）。ドラッグで変更可 |

**一意制約**
- **ID** は一意。

**残高の整合性（ACCOUNT.BALANCE と ACCOUNT_HISTORY）**
- **ACCOUNT.BALANCE は、当該勘定の ACCOUNT_HISTORY の最新レコード（同一 ACCOUNT_ID で TRANSACTION_ID が最も新しい取引時点）の BALANCE と一致すること**を仕様とする。実績取引の登録・更新・削除時に、勘定残高を増減させると同時に ACCOUNT_HISTORY に履歴を追加し、ACCOUNT.BALANCE を更新する。
- 取引削除時は、当該取引による残高変動を巻き戻す（逆方向の変動を ACCOUNT に反映し、ACCOUNT_HISTORY に TRANSACTION_STATUS = `delete` のレコードを追加する）。再計算が必要な場合は、当該勘定の ACCOUNT_HISTORY を TRANSACTION_ID 順にたどって残高を再構築できるようにする。

---

## 3. 勘定項目参照権限テーブル（ACCOUNT_PERMISSION）

**ファイル**: `data/ACCOUNT_PERMISSION.csv`

どのユーザーがどの勘定項目を参照・編集できるかを表すテーブルです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID |
| ACCOUNT_ID | 勘定項目ID | ACCOUNT.ID |
| USER_ID | 参照を許可するユーザーID | USER.ID |
| PERMISSION_TYPE | 権限種別 | `view`（参照） / `edit`（編集） |

**一意制約**
- **(ACCOUNT_ID, USER_ID)** は一意。同一の「勘定・ユーザー」の組み合わせは1行のみ登録する。同一ユーザーに同一勘定の権限を複数回付与することはできない。アプリ側で重複登録しないようにする。

---

## 4. 勘定項目履歴テーブル（ACCOUNT_HISTORY）

**ファイル**: `data/ACCOUNT_HISTORY.csv`

勘定項目ごとの取引に紐づく残高履歴を表すテーブルです。取引の登録・更新・削除時の残高を記録します。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 勘定項目履歴の一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 省略可 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照。省略可 |
| UPDATE_DATETIME | 更新日時 | 省略可 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照。省略可 |
| ACCOUNT_ID | 勘定項目ID | ACCOUNT.ID への参照 |
| TRANSACTION_ID | 取引ID | TRANSACTION.ID への参照 |
| BALANCE | 残高 | 当該取引時点の勘定残高（数値） |
| TRANSACTION_STATUS | 取引ステータス | `regist`（登録） / `update`（更新） / `delete`（削除） |

**一意制約**
- **ID** は一意。同一 (ACCOUNT_ID, TRANSACTION_ID) で複数レコードが存在し得るのは、同一取引の「更新」で複数回履歴が書かれる場合（regist → update など）。通常は「1取引1勘定あたり、登録・更新・削除それぞれで1レコード」を想定。同一取引の同一勘定に対する履歴は時系列で複数になる。

---

## 5. カテゴリテーブル（CATEGORY）

**ファイル**: `data/CATEGORY.csv`

収支の分類（費目・収入の種類）を表すマスタです。階層構造を持てます（PARENT_ID で親を指定）。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | カテゴリの一意識別子 | 数値。TRANSACTION.CATEGORY_ID から参照 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
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

**一意制約**
- **ID** は一意。
- **PARENT_ID** は自己参照のため、同一 ID の行は1つの親のみ持つ（ツリー構造）。

---

## 6. タグテーブル（TAG）

**ファイル**: `data/TAG.csv`

収支に付与するタグのマスタです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | タグの一意識別子 | 数値。他テーブルから参照される |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TAG_NAME | タグの表示名 | 例: 食費, 交通費, 娯楽 |
| COLOR | 色 | 例: #ff0000 やカラーコード。任意。一覧・ピッカーで変更可 |
| ICON_PATH | アイコンパス | 例: /icon/custom/xxx.svg。任意。一覧・ピッカーで変更可 |
| SORT_ORDER | 表示順 | 同テーブル内の並び順（数値）。ドラッグで変更可 |

**一意制約**
- **ID** は一意。

---

## 7. タグ管理テーブル（TAG_MANAGEMENT）

**ファイル**: `data/TAG_MANAGEMENT.csv`

「どの収支（TRANSACTION）にどのタグ（TAG）が付いているか」を表す中間テーブルです。  
1件の収支に複数タグを付けられます。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TRANSACTION_ID | 収支ID | TRANSACTION.ID への参照 |
| TAG_ID | タグID | TAG.ID への参照 |

**一意制約**
- **(TRANSACTION_ID, TAG_ID)** は一意。同一の「取引・タグ」の組み合わせは1行のみ登録する。アプリ側で重複登録しないようにする。

---

## 8. 収支テーブル（TRANSACTION）

**ファイル**: `data/TRANSACTION.csv`

収入・支出の計画および実績を表すテーブルです。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 収支の一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TRANSACTION_TYPE | 収支種別 | `income`（収入） / `expense`（支出） / `transfer`（振替） |
| PROJECT_TYPE | 計画 | `plan`（予定） / `actual`（実績） |
| CATEGORY_ID | カテゴリID | CATEGORY.ID への参照 |
| NAME | 項目名 | 例: 給与, スーパー買い物 |
| TRANDATE_FROM | 取引日（開始） | 日付（YYYY-MM-DD）。実績の場合は 1 日のみ入力可能で TRANDATE_TO と同一日を設定。予定の場合は範囲の開始日 |
| TRANDATE_TO | 取引日（終了） | 日付（YYYY-MM-DD）。実績の場合は TRANDATE_FROM と同一日。予定の場合は範囲の終了日 |
| FREQUENCY | 頻度 | `day` / `daily` / `weekly` / `monthly` / `yearly` |
| INTERVAL | 間隔 | 数値。2 のとき「2日ごと」「2週間ごと」「2か月ごと」「2年ごと」など。`day` の場合は 0、それ以外は 1 以上 |
| CYCLE_UNIT | 繰り返し単位 | 週・日・年単位の指定を結合した文字列。`day` / `daily` の場合は空。`weekly` の場合は SU,MO,TU,WE,TH,FR,SA のいずれか複数をカンマ区切り（例: MO,WE,FR）。`monthly` の場合は 1～31（固定日）、-1（月末）、-2（月末の前日）、-3（月末の2日前）のいずれか複数をカンマ区切り（例: 1,15,-1）。`yearly` の場合は MMDD 形式の日付を複数カンマ区切り（例: 0320,1225） |
| AMOUNT | 金額 | 数値（円など単位はアプリ側で統一） |
| MEMO | メモ | 任意 |
| ACCOUNT_ID_IN | 勘定項目ID（収入、振替） | ACCOUNT.ID への参照。収益や振替の入金先を指定 |
| ACCOUNT_ID_OUT | 勘定項目ID（支出、振替） | ACCOUNT.ID への参照。費用や振替の出金元を指定。 |
| PLAN_STATUS | 予定状況 | `planning`（計画中） / `complete`（完了） / `canceled`（中止）。PROJECT_TYPE が plan のときは planning、actual のときは complete を初期値とする。 |
| DLT_FLG | 削除フラグ | 0＝有効、1＝削除扱い。初期値 0。取引削除時は物理削除せず 1 にして論理削除する。 |

**一意制約**
- **ID** は一意。

**業務制約（PLAN_STATUS）**
- **PROJECT_TYPE = actual（実績）の場合、PLAN_STATUS は `complete` 固定**とする。実績取引に `planning` や `canceled` は設定しない。アプリ側で実績登録・更新時に complete 以外を設定しないようにする。
- PROJECT_TYPE = plan（予定）の場合は planning / complete / canceled のいずれかを設定可能。

**将来拡張のメモ**
- TRANSACTION は「予定・実績・繰り返しルール・単発・振替・残高影響」を一テーブルで持つ。現状は問題ないが、将来パフォーマンスや保守性の観点で次の分離を検討し得る：繰り返し設定（FREQUENCY / INTERVAL / CYCLE_UNIT）を別テーブルに分離、実績生成済フラグの追加など。SQLite 移行時に正規化の余地として記載する。

---

## 9. 取引予定-実績紐付けテーブル（TRANSACTION_MANAGEMENT）

**ファイル**: `data/TRANSACTION_MANAGEMENT.csv`

「どの取引予定（plan）にどの取引実績（actual）が紐づいているか」を表す中間テーブルです。  
1件の取引予定に複数の取引実績を紐づけられます。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| TRAN_PLAN_ID | 取引予定ID | TRANSACTION.ID（PROJECT_TYPE=plan）への参照 |
| TRAN_ACTUAL_ID | 取引実績ID | TRANSACTION.ID（PROJECT_TYPE=actual）への参照 |

**一意制約**
- **(TRAN_PLAN_ID, TRAN_ACTUAL_ID)** は一意。同一の「予定・実績」ペアの重複登録は禁止。
- **TRAN_ACTUAL_ID** は一意とする（1件の実績は1つの予定にのみ紐づける。同一実績を複数予定に紐づけることはできない）。アプリ側で強制する。

---

## 10. 取引月別集計テーブル（TRANSACTION_MONTHLY）

**ファイル**: `data/TRANSACTION_MONTHLY.csv`

取引データの月別集計を保持するテーブルです。全テーブル共通の ID・VERSION・監査項目に加え、集計結果を格納します。

| 列名 | 説明 | 備考 |
|------|------|------|
| ID | 一意識別子 | 数値 |
| VERSION | 楽観的ロック用 | 初期値 0。更新時に 1 増やす |
| REGIST_DATETIME | 登録日時 | 共通 |
| REGIST_USER | 登録ユーザーID | USER.ID への参照 |
| UPDATE_DATETIME | 更新日時 | 共通 |
| UPDATE_USER | 更新ユーザーID | USER.ID への参照 |
| ACCOUNT_ID | 勘定項目ID | ACCOUNT.ID への参照 |
| PROJECT_TYPE | 計画 | 予定（plan）または実績（actual）の種別 |
| YEAR | 年 | 集計対象年（数値） |
| MONTH | 月 | 集計対象月（1～12） |
| INCOME_TOTAL | 収入の合計 | 当該勘定・計画種別・年月の収入合計 |
| EXPENSE_TOTAL | 支出合計 | 当該勘定・計画種別・年月の支出合計 |
| BALANCE_TOTAL | 残高合計 | 収入合計－支出合計（または集計ルールに従う残高） |

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
- **TRANSACTION**（予定）と **TRANSACTION**（実績）は **TRANSACTION_MANAGEMENT** を通じて、1件の予定に複数の実績を紐づけられる。
- **CATEGORY** は PARENT_ID で親子関係を持てる（階層構造）。

---

## データ整合性ポリシー

- **参照整合性はアプリ側で保証する**。存在しない ID を他テーブルから参照しない。REGIST_USER / UPDATE_USER には存在する USER.ID を設定する。CATEGORY_ID, ACCOUNT_ID_IN, ACCOUNT_ID_OUT, TRANSACTION_ID, TAG_ID 等も、参照先テーブルに存在する ID のみを設定する。
- **削除時は参照の有無をチェックする**。勘定を削除する場合は、当該勘定を参照する TRANSACTION や ACCOUNT_PERMISSION の扱いを決める（禁止するか、参照をクリアするか）。タグ・カテゴリ削除時も、参照している取引や TAG_MANAGEMENT の扱いをアプリ側で一貫して行う。
- **残高は履歴から再構築可能であること**。ACCOUNT.BALANCE と ACCOUNT_HISTORY の整合性を保ち、不整合が生じた場合は当該勘定の ACCOUNT_HISTORY を先頭から適用して BALANCE を再計算できるようにする。

---

## パフォーマンス・CSV 運用の注意

- **CSV ではテーブル全体を読み書きする**。TRANSACTION の件数が増えると、一覧取得やバージョンチェック時の走査コストが増える。**おおよそ 5000 件を超える規模になったら SQLite 等への移行を推奨する**。移行時は ID を INTEGER PRIMARY KEY 相当で管理し、一意制約・参照整合性を DB 側でも定義するとよい。
- バージョンチェック時は、更新対象行の VERSION を確認するために、現状は CSV を再取得するか対象行だけを特定する必要がある。CSV のままでは「単一キー検索」が線形探索になる点に注意する。

---

## public/data と Tauri 保存の関係（開発時）

- **本番**: アプリ終了時・ログアウト時に `save_master_csv` が **app_data_dir/data/** に ACCOUNT/CATEGORY/TAG を保存する。
- **開発（debug）**: 上記に加え、**データ行が含まれる場合のみ** `public/data/` にも同じ内容を書き、プロジェクト側の CSV を更新する。
- **過去の不具合**: ログアウトやウィンドウ閉じるたびに localStorage の内容で CSV を上書きしていた。localStorage が空（マスタ画面を開いていない・クリア済みなど）のときに「ヘッダーだけ」の CSV で上書きされ、**public/data の既存データが消えていた**。現在は「2行目以降があるときだけ public/data に書く」ようにして、ヘッダーだけでの上書きを防いでいる。

---

## 運用上の注意

- **新規 ID** は、当該テーブルの既存行の最大 ID + 1 で付与する。**削除した行の ID は再利用しない**（「ID 採番ルール」を参照）。
- 日付は **YYYY-MM-DD**、日時は **YYYY-MM-DD HH:MM:SS** 形式を推奨します。
- 金額は整数または小数で統一し、単位（円など）はアプリ側で固定する想定です。
- **REGIST_USER** / **UPDATE_USER** には存在する USER.ID を設定してください。
- **参照整合性**はアプリ側で保証する（「データ整合性ポリシー」を参照）。存在しない ID を他テーブルから参照しない。
- **COLOR** は16進カラーコード（例: #646cff）を推奨。アプリの色・アイコンピッカーでプリセットまたはカスタム色を選択できます。
- **ICON_PATH** は `/icon/custom/ファイル名.svg` 形式。`public/icon/custom/` に配置した SVG は、ビルド時に `icons.json` に列挙され、ピッカーで選択できます。
