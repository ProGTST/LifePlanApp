# CSV 取得・更新フローとキャッシュ・localStorage 仕様

本ドキュメントでは、LifePlanApp における **CSV の取得・更新の流れ** および **キャッシュ**・**localStorage** の使用タイミングを整理する。

---

## 1. CSV 取得・更新の基本フロー

### 1.1 読み取り（GET）

- **経路**: フロント → `fetchCsv(path)` → `fetchCsvFromApi(name)` → **GET `/api/data/:name`**
- **実体**: Fastify API が **Node キャッシュ**から返却。未キャッシュ時は `public/data/*.csv` を読み込み、キャッシュへ格納してから返す。レスポンスに **`X-Data-Version`** ヘッダでキャッシュバージョンを付与。
- **HTTP キャッシュ**: 使用しない（廃止）。フロントは `fetch(url)` をそのまま呼び、キャッシュ制御は行わない。

### 1.2 保存（POST）

- **経路**: フロント → `saveCsvViaApi(name, csv, expectedVersion?)` → **POST `/api/data/:name`**（body: `{ csv, expectedVersion? }`）
- **楽観ロック（改善①）**: サーバー側で `expectedVersion` とキャッシュの `version` を比較。不一致なら **409 Conflict** を返し保存しない。フロントは取得時の `X-Data-Version` を `lastCsvVersions` に保持し、保存時に `expectedVersion` として送る。
- **サーバー側**: 検証通過後、ファイル書き込み → **ディスクに書き込んだ内容を再読込し Node キャッシュに反映**（mtime 含む）→ `version` インクリメント。レスポンスに **`X-Data-Version`** を付与。これにより、カテゴリー・タグ等の保存直後の GET で最新データが返る。

### 1.3 楽観ロック（競合時挙動）

- **更新・削除前**: 対象行の `VERSION` を CSV から再取得して、編集中の値と比較する（`csvVersionCheck.ts` の `checkVersionAndGetMessage` 等）。
- **競合時（VERSION 不一致）**:
  - アラートで「他のユーザーが更新しました」等のメッセージを表示し、**保存は行わない**。
  - ユーザーは「最新のデータを取得」して画面を再表示し、必要なら再度編集して保存する。
- **対象行が CSV に存在しない場合**: 「他のユーザーが更新しました。該当のデータはありません。」と表示し、最新データを取得して画面に再表示する。
- 詳細は `public/docs/DATA_CSV.md` の「楽観的ロック」「バージョンチェック」を参照。

---

## 2. キャッシュの種類と使用タイミング

キャッシュの責務を次のように分離している。

| 種類 | 責務 | 本アプリでの方針 |
|------|------|------------------|
| **HTTP キャッシュ** | ネットワーク最適化 | ❌ **廃止**。Tauri + 同一プロセス API では効果が薄く、Node キャッシュと責務が競合するため使用しない。 |
| **Node キャッシュ** | データ整合性・I/O 最適化 | ✅ **導入**。Fastify 側でメモリキャッシュ（ファイル名 → `{ text, version, mtimeMs }`）。GET は mtime 一致時キャッシュ返却・不一致時再読込。POST は expectedVersion で楽観ロック。meta エンドポイントでポーリング軽量化。 |
| **フロントメモリ** | UI 再描画最適化 | ⚠ **最小限で維持**。画面遷移時の再取得抑制など、UI 体感のためだけに利用する。 |

### 2.1 Node キャッシュ（Fastify 側）✅

- **場所**: `server/index.mjs` の `dataCache`（`Map<baseName, { text, version, mtimeMs }>`）。
- **version**: CSV には持たせない。サーバー起動時は 1、POST のたびにインクリメント（改善②）。
- **GET `/api/data/:name`**: キャッシュの `mtimeMs` とファイルの mtime を比較。不一致ならファイル再読込してキャッシュ更新（**外部で CSV を直接編集された場合の耐性**）。レスポンスヘッダ **`X-Data-Version`** で version を返す。
- **POST `/api/data/:name`**: `expectedVersion` が渡されていればキャッシュの version と照合。一致時のみファイル保存・キャッシュ更新・version インクリメント。
- **GET `/api/data/:name/meta`（改善③）**: ポーリング用。`{ version, lastUpdatedUser }` のみ返却。ポーリングはまず meta のみ取得し、version が変わったときだけ本体 CSV を取得するため負荷を軽減。

### 2.2 フロントのメモリキャッシュ（UI 最適化用途のみ）⚠

※ **ブラウザ（または Tauri WebView）上の JavaScript 変数**。データの正しさは Node キャッシュに依存し、ここでは「再描画を減らす」用途に限定する。

| 対象 | 保持場所 | 無効化タイミング |
|------|----------|------------------|
| 取引・マスタ（収支履歴・カレンダー・スケジュール） | `transactionDataSync.ts` の `transactionDataVersion` および内部変数 | `invalidateTransactionDataCache()` 呼び出し時（収支記録の保存後など） |
| 勘定一覧 | `state.accountListFull` | 画面の `loadAndRenderAccountList` で再取得したときに上書き |
| カテゴリー一覧 | `state.categoryListFull` | 画面の `loadAndRenderCategoryList` で再取得したときに上書き |
| タグ一覧 | `state.tagListFull` | 画面の `loadAndRenderTagList` で再取得したときに上書き |
| デザイン（パレット） | `design-screen.ts` の `paletteList` | `loadAndRenderDesign` で再取得したときに上書き |

- **収支履歴・カレンダー・スケジュール**: `loadTransactionData(noCache)` で、`noCache === false` かつ `transactionDataVersion !== 0` のときは **再取得せず即 resolve**（UI の体感速度のため）。**transactionDataVersion（改善④）**: サーバーの `X-Data-Version`（TRANSACTION.csv の version）と同期する。0 は未読み込み/無効化。将来 `if (serverVersion !== localVersion)` での再取得に拡張可能。
- **マスタ画面**: 画面表示・データ最新化時はいずれも `fetchCsv(path)` のみ。HTTP キャッシュ指定は行わない。

---

## 3. localStorage の使用タイミング

localStorage は **2 種類の用途** で使われる。

**責務の原則（改善⑤）**:

- **CSV が常に正**: データの正真性は常にサーバー側の CSV（Node キャッシュ）が持つ。localStorage は「真実」ではなく UI 用の補助に限定する。
- **localStorage = UI キャッシュ**: 起動直後の**先出し表示**（読み込み中の表示や直近の表示値の先行表示）にのみ使い、**CSV 取得後は必ず CSV を正とする**。表示時は「CSV で取得 → 取得後はその値を正とし、localStorage はあくまでキャッシュ」とみなす。

### 3.1 カラーパレット（デザイン画面）

| キー | 用途 | 読み書きタイミング |
|------|------|--------------------|
| `lifeplan_color_palette` | ユーザー別のカラーパレット（パレットキー → 6桁 hex） | **読む**: デザイン画面の `loadAndRenderDesign` 時、および `applyUserPalette`（ログイン後・アプリ起動時）。**書く**: デザイン画面で保存ボタン押下時（**CSV 保存成功後にのみ** `setColorPalette(userId, toStore)`）。 |

**仕様**:

- **表示**: `COLOR_PALETTE.csv` を API で取得したあと、同一ユーザーのパレットが localStorage にあれば**先出し・キャッシュとして**その値でフォーム・プレビューを補う。**正は CSV 取得結果**であり、localStorage は UI 用キャッシュである。
- **保存**: **必ず CSV を先に保存し、成功した場合のみ** localStorage を更新する。CSV が失敗したら localStorage は更新しない（整合性のため）。
- ログアウト・終了時に **dirty なら** `saveColorPaletteCsvOnNavigate` で CSV を保存する。localStorage はそのまま残る（上書きしない）。

### 3.2 CSV 監視用「表示キー」一覧

| キー | 用途 | 読み書きタイミング |
|------|------|--------------------|
| `lifeplan_csvwatch_displayed` | 画面ごとに「いま表示しているデータのキー一覧」（例: 行 ID の配列） | **書く**: 各画面の `loadAndRender` や検索適用後に `setDisplayedKeys(viewId, keys)` を呼ぶ。**読む**: CSV 監視ポーリングで「更新された行のキー」がこの一覧に含まれるか判定するとき。 |

**仕様**:

- ポーリングで CSV が更新されたとき、「更新したユーザーが自分でない」かつ「更新された行の表示キーが、その画面の表示キー一覧に含まれる」場合のみ「データが更新されました。最新のデータを取得しますか？」と通知する。
- 画面 ID とキー配列の対応は `Record<viewId, string[]>` として 1 つの JSON で保持する。

---

## 4. 画面別の CSV 取得・更新フロー概要

| 画面 | 初回表示時の取得 | データ最新化時 | 保存時 | 備考 |
|------|------------------|----------------|--------|------|
| ホーム | USER.csv（API・Node キャッシュ経由） | 再取得（Node キャッシュから返却） | なし | ヘッダー表示用。HTTP キャッシュは使わない |
| 勘定項目 | ACCOUNT.csv, ACCOUNT_PERMISSION.csv（API） | 同上 | saveAccountCsvOnly → API 保存、clearAccountDirty | |
| カテゴリー | CATEGORY.csv（API） | 同上 | saveCategoryCsvOnly、clearCategoryDirty | |
| タグ | TAG.csv（API） | 同上 | saveTagCsvOnly、clearTagDirty | |
| プロフィール | USER.csv（API） | 同上 | saveUserCsvOnNavigate | |
| デザイン | COLOR_PALETTE.csv（API）＋ localStorage で上書き | 同上 | CSV 保存 → 成功時のみ localStorage 更新、clearColorPaletteDirty | 1 ユーザー 1 パレット |
| 収支履歴・カレンダー・スケジュール | loadTransactionData()（複数 CSV を API 取得） | loadTransactionData(true) で再取得 | 各画面で POST（TRANSACTION 等）。保存後に invalidateTransactionDataCache | フロントは transactionDataVersion で UI 最適化のみ |
| 収支記録（取引登録） | 各種 CSV を API 取得 | 同上 | 複数 CSV を順次 POST。保存後に invalidateTransactionDataCache | |
| 取引分析 | loadTransactionData() を利用 | 同上 | なし（参照のみ） | 画面内で集計用キャッシュ（cachedByCategoryMonth 等）あり |

---

## 5. ログアウト・終了時の保存フロー

- **saveDirtyCsvsOnly()**: 未保存のマスタだけ CSV 保存する。
  - `accountDirty` → saveAccountCsvOnly
  - `categoryDirty` → saveCategoryCsvOnly
  - `tagDirty` → saveTagCsvOnly
  - `userDirty` → saveUserCsvOnNavigate
  - `colorPaletteDirty` → saveColorPaletteCsvOnNavigate
- **dirty フラグ**: 各マスタを編集したら `setXxxDirty()`、保存完了後に `clearXxxDirty()`。保存は「画面離脱時」または「保存ボタン押下時」で行い、ログアウト・終了時は dirty なものだけ API に送る。
- **localStorage**: ログアウト時にクリアする仕様にはなっていない。カラーパレットと「表示キー」はそのまま残る。

---

## 6. CSV 監視（ポーリング）の流れ

- **開始**: ログイン後、`main.ts` の `initAppScreen()` 内で `startCsvWatch(getState)` を呼ぶ。`getState` は `{ view: currentView, userId: currentUserId }` を返す。
- **間隔**: 15 秒ごと（`POLL_INTERVAL_MS`）。
- **処理（改善③）**: 各ファイルについて **GET `/api/data/:name/meta`** で `version` と `lastUpdatedUser` のみ取得。`version` が前回と変わったときだけ **本体 CSV を GET** し、最新更新行の表示キーを取得。**現在表示中の画面がその CSV の画面**かつ**更新者が自分でない**かつ**更新行の表示キーが localStorage の表示キー一覧に含まれる**場合のみ、「データが更新されました。最新のデータを取得しますか？」と通知。OK なら `triggerRefreshForView(viewId)` でその画面の refresh ハンドラを実行する。meta のみのポーリングで負荷を軽減。
- **停止**: ログアウト時などに `stopCsvWatch()` を呼ぶ。

---

## 7. まとめ

| 項目 | 内容 |
|------|------|
| **CSV 取得** | GET `/api/data/:name`。フロントは `fetchCsv(path)` のみ。HTTP キャッシュは使わない。サーバーは Node キャッシュから返却し、`X-Data-Version` ヘッダを付与。 |
| **CSV 更新** | POST `/api/data/:name`。サーバーはファイル保存後に Node キャッシュを更新・version インクリメント。保存後に dirty クリアや `invalidateTransactionDataCache` を行う。 |
| **HTTP キャッシュ** | ❌ **廃止**。フロントは `fetch(url)` に cache 指定を付けない。 |
| **Node キャッシュ** | ✅ Fastify 側の `dataCache`（ファイル名 → `{ text, version }`）。データ整合性・I/O 最適化の責務。 |
| **フロントメモリ** | ⚠ **UI 最適化のみ**。`transactionDataVersion` や accountListFull 等。再描画抑制に利用。データの正しさは Node キャッシュに依存。 |
| **localStorage（パレット）** | デザインで保存した色をユーザー別に保持。読み込み時は CSV のあとで上書き。保存時は CSV 成功後にのみ localStorage 更新。 |
| **localStorage（表示キー）** | CSV 監視で「今表示している行」を画面別に保持し、更新通知の要不要判定に利用。 |

---

## 8. 設計上のリスクと改善提案（レビュー反映）

以下は、将来的な不具合・複雑化を防ぐための**リスク認識**と**改善案**をまとめたものである。実装の優先度は別途判断すること。

### 8.1 認識されているリスク一覧

| リスク | 内容 | 対応状況 |
|--------|------|----------|
| ~~HTTP キャッシュ制御の分散~~ | ~~reload / no-store がバラバラ~~ | ✅ **解消**。HTTP キャッシュを廃止し、Node キャッシュに一本化。 |
| localStorage と CSV の二重管理 | 整合性リスク。 | ✅ CSV 成功後にのみ localStorage 更新に変更済み。 |
| ~~transactionDataLoaded フラグ~~ | ~~boolean のみで破綻しやすい~~ | ✅ **解消**。`transactionDataVersion` に変更済み。フロントメモリは UI 最適化のみ。 |
| ポーリング設計 | CSV 全取得→ハッシュ比較。データ件数増加時に重くなり得る。 | 改善案は 8.6（メタエンドポイント）。 |
| ログアウト時保存 | dirty のみ保存のため、クラッシュ時は未保存のまま終了し得る。 | 改善案は 8.7。 |

### 8.2 アーキテクチャ視点：良い点

- GET/POST の責務が明確である。
- dirty フラグ管理が整理されている。
- `invalidateTransactionDataCache` によりキャッシュ無効化の入口が存在する。
- 「最新化」と「通常表示」が分離されており、設計として妥当である。

### 8.3 改善提案①：HTTP キャッシュ → Node キャッシュへ置き換え ✅ 対応済み

**方針**: HTTP キャッシュは廃止し、**Node キャッシュ**を導入。フロントのメモリキャッシュは **UI 最適化用途のみ** 維持。

- **実装**: Fastify（`server/index.mjs`）に `dataCache`（Map）を追加。GET はキャッシュ返却＋`X-Data-Version` ヘッダ、POST でキャッシュ更新・version インクリメント。フロントは `fetchCsv(path)` のみで、HTTP の cache 指定は一切行わない。データ整合性・I/O 最適化は Node、再描画の最適化はフロントメモリが担当。

### 8.4 改善提案②：メモリキャッシュのバージョン管理 ✅ 対応済み

**問題**: `transactionDataLoaded` が boolean のみのため、部分更新・他画面更新・複数ユーザー対応で破綻しやすい。

**改善案**: boolean ではなく**バージョンまたはハッシュ**を持つ。

- 例: `transactionDataVersion: number` または `transactionDataHash: string` を保持する。
- 将来: `if (serverVersion > localVersion) reload` のように、サーバーと比較して再取得する設計に発展させやすい。
- **実装**: `transactionDataSync.ts` で `transactionDataLoaded` を廃止し、`transactionDataVersion`（number）を採用。0 は未読み込み/無効化、読み込み完了時に `Date.now()` をセット。`invalidateTransactionDataCache()` は `transactionDataVersion = 0` にする。

### 8.5 改善提案③：localStorage と CSV の整合性 ✅ 対応済み

**問題**: カラーパレットで「CSV 保存 ＋ localStorage 保存」を並行して行うと、CSV 保存失敗時に localStorage だけ成功し、次回起動でローカルが優先されてサーバーと不整合になり得る。

**改善案**:

- **保存順の厳守**: 必ず **CSV 保存 → 成功したら localStorage 更新** の順にする。CSV が失敗したら localStorage は更新しない。
- または **localStorage を「キャッシュ」として扱う設計**にし、**正は常に CSV（サーバー）**とする。読み込み時は CSV を正とし、localStorage はオフライン用や表示の先行用に限定する。
- **実装**: デザイン画面の `saveDesignForm` および `saveColorPaletteCsvOnNavigate` で、**必ず CSV 保存を先に実行し、成功した場合のみ `setColorPalette` で localStorage を更新**する順序に変更。

### 8.6 改善提案④：CSV 監視ポーリングの軽量化

**現状の良い点**: 更新者チェック・表示キー一致判定・画面別トリガーは設計として妥当である。

**問題**: 現状は CSV 全体を取得してハッシュ比較するため、データ件数増加時に重くなりやすい。

**改善案**: API 側で**メタ情報エンドポイント**を用意する。

- 例: `GET /api/data/:name/meta` → `{ lastUpdatedAt, lastUpdatedUser }` を返す。
- ポーリングではまずこのメタのみ取得し、変更があればそのときだけ CSV 本体を取得する（または通知のみ行う）。
- 全 CSV 取得が不要になり、Tauri 環境でも効率的である。

### 8.7 改善提案⑤：ログアウト・終了時保存とクラッシュ耐性

**現状の良い点**: dirty のみ保存する設計は責務として正しい。

**問題**: ブラウザクラッシュやタブ閉鎖時には `saveDirtyCsvsOnly` が呼ばれず、未保存のマスタが失われる。

**改善案**:

- **重要マスタは編集確定ごとに即保存**する運用に寄せる（保存ボタン押下やモーダル確定時に必ず API 保存）。dirty は「画面離脱・ログアウト時のまとめ保存」の補助とする。
- 取引はすでに即保存されているため、マスタも即保存に寄せると UX とデータ保全の両面で安定しやすい。
