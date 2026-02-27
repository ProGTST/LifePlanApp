# スタイルのコーディングルール・リファクタリング基準

このドキュメントは、CSS/スタイルの修正・追加時に「コードがきれいになる」よう振り返るための基準です。新規スタイルを書くとき・既存スタイルを直すときのチェックリストとして利用してください。

---

## 1. 全体方針

| 項目 | ルール |
|------|--------|
| **デザイントークン** | 色・余白・フォント・角丸・シャドウは `tokens.css` の変数を使う。ハードコード（`#333`, `16px` など）を書かない。 |
| **!important** | 使用禁止。詳細度の調整・レイヤー・記述順で解決する。 |
| **命名** | BEM ベース（Block__Element--Modifier）＋状態クラス（`.is-*`）。新規は必ず従う。 |
| **レイヤー** | layout → components → utilities → overrides の順を守り、責務ごとにファイル・レイヤーを分ける。 |
| **Tailwind** | 既存スタイルはそのまま。新規・余白・レイアウトは Tailwind ユーティリティの併用を検討する。 |

---

## 2. ファイル構成と読み込み順

### 2.1 エントリ

- **Vite が読み込むのは `src/styles/main.css` のみ**（`src/main.ts` で import）。
- `main.css` では **@import を必ず先頭に** まとめ、次の順で読み込む。

```
@import "./tailwind-layer.css";   /* Tailwind base / components / utilities */
@import "./tokens.css";           /* デザイントークン */
@import "./app.css";              /* アプリスタイル（layout / components の @import 含む） */
```

- 理由: PostCSS の「@import は他の文より前に書く」ルールを満たしつつ、Tailwind → トークン → アプリの適用順を保つため。

### 2.2 ディレクトリ構成

```
src/styles/
  main.css              # エントリ（上記 3 つの @import のみ）
  tailwind-layer.css    # @tailwind base/components/utilities のみ
  tokens.css            # :root のプリミティブ ＋ #app のセマンティック
  app.css               # @layer 定義 ＋ layout/component の @import ＋ @layer components 内の残り
  login.css             # ログイン画面専用（必要なら tokens を参照）
  layout/
    app-shell.css       # レイアウト・メニューバー・サイドバー・ヘッダー・フッター
    view.css            # ビュー共通・view-body・各画面のビュー構造
  components/
    data-table.css      # データテーブル
    modal.css           # モーダル
```

### 2.3 app.css 内のルール

- **@import はファイル先頭**にまとめる（`@layer` や `@tailwind` より前）。
- レイヤー定義は `@import` の直後に 1 行で書く。

```css
@import "./layout/app-shell.css";
@import "./layout/view.css";
@import "./components/data-table.css";
@import "./components/modal.css";

@layer layout, components, utilities, overrides;

@layer components {
  /* フォーム・ボタン・画面固有スタイルなど */
}
```

- 新規で layout / コンポーネントを追加するときは、上記のとおり **layout/*.css または components/*.css に切り出し、app.css で @import** する。

---

## 3. デザイントークン

### 3.1 使う場所

- **tokens.css** に定義があるものは、**必ず `var(--名前)` で参照**する。
- 新しい定数（色・余白・フォントサイズなど）が必要なときは、**まず tokens.css に変数を追加**してから使う。

### 3.2 トークンの種類

| 種類 | 例 | 定義場所 |
|------|-----|----------|
| プリミティブ | `--space-1`～`--space-8`, `--font-size-*`, `--gray-50`～`--gray-800`, `--radius-sm`～`--radius-xl`, `--shadow-sm/md/lg` | `:root` |
| セマンティック（色・コンポーネント） | `--color-menubar-bg`, `--color-header-bg`, `--icon-size`, `--btn-height-md` | `#app`（パレットで上書き可能） |

### 3.3 禁止事項

- 色の直書き: `#333`, `rgb(0,0,0)` → `var(--gray-800)` などに置き換える。
- マジックナンバー: `padding: 12px` → `var(--space-3)` など、トークンがあればトークンを使う。
- トークンが無い場合は、**追加してから**使用する。

---

## 4. 命名規則（BEM ＋ 状態クラス）

詳細は `docs/CSS_NAMING_CONVENTIONS.md` を参照。ここでは要点のみ。

### 4.1 ブロック・要素・修飾子

| 種別 | 形式 | 例 |
|------|------|-----|
| ブロック | ケバブケース | `app-menubar`, `data-table`, `modal-overlay` |
| 要素 | `Block__element` | `app-menubar__icon`, `app-menubar__title` |
| 修飾子 | `Block--modifier` / `Block__element--modifier` | `schedule-view-summary--left`, `btn-header-add` |

### 4.2 状態クラス（JS で付与・削除するもの）

- **`.is-*`** に統一する。
- 例: `.is-visible`, `.is-active`, `.is-current`, `.is-hidden`, `.is-disabled`, `.is-selected`, `.is-empty`
- 修飾子（`--current`）と状態が両方ある場合は **`.is-current` に統一**。

### 4.3 セレクタの書き方

```css
/* 状態 */
.sidebar-menu-item.is-current { }

/* 修飾子 */
.block--modifier { }

/* 要素＋状態 */
.block__element.is-active { }
```

- 新規クラスを追加するときは、上記ルールに合わせる。既存の `block-element`（ハイフン 1 本）はリファクタ時に `__` に寄せる。

---

## 5. CSS レイヤー

### 5.1 レイヤー順（優先度は overrides が最も高い）

1. **layout** … 画面構造（.app-layout, .app-body, .view-body など）
2. **components** … ボタン・フォーム・テーブル・モーダルなど
3. **utilities** … 汎用ヘルパー（必要に応じて）
4. **overrides** … 詳細度を上げずに上書きしたいときの最後の手段（!important の代替）

### 5.2 どのファイルでどのレイヤーか

- **layout/app-shell.css**, **layout/view.css** … 先頭で `@layer layout { ... }` で囲む。
- **components/data-table.css**, **components/modal.css** … 先頭で `@layer components { ... }` で囲む。
- **app.css** の大きなブロック … `@layer components { ... }` 内に記述。

新しい layout / コンポーネント用ファイルを追加するときも、**必ず同じレイヤーで囲む**。

### 5.3 レイヤー起因のデグレ（layout が components に負ける）

#### 原因

CSS レイヤーでは **後続のレイヤーが勝つ**。そのため、**詳細度に関係なく** components 層のルールが layout 層のルールを上書きする。

- layout 層: サイドバーメニューなどに `background` / `color` を指定
- components 層: `#app button` で全ボタンに `background` / `color` を指定
→ **layout のスタイルが components に上書きされ、見た目が効かなくなる**

#### デグレの典型例

| 症状 | 該当箇所 |
|------|----------|
| サイドバーメニューで `.is-current` の強調表示が効かない | `.sidebar-menu-item`, `.sidebar-settings-item` |
| ホバー時の背景色・非強調時の見た目が反映されない | `:hover:not(.is-current)` など |
| layout 内の `<button>` が、意図と違う色・背景で表示される | `#app button` より前のレイヤーに書いたスタイル |

#### 改善方法

1. **components 層に上書きルールを追記**（詳細度で勝たせる）  
   - `#app button` と同じレイヤー内に、`#app .app-sidebar .sidebar-menu-item` など、より詳細なセレクタで追記する。同一レイヤー内では詳細度が効く。

2. **@layer overrides に移す**  
   - 上書きしたいルールだけ `@layer overrides { ... }` に移す。レイヤー順で components より後ろになり、詳細度を上げずに解決できる。

3. **責務の見直し**  
   - layout 内の「コンポーネント的な」見た目（ボタンの色・状態）は、本来 components に書くのが望ましい。layout は構造（配置・余白）に寄せる。

---

## 6. !important 禁止

- **一切使わない。** Stylelint の `declaration-no-important` でエラーになる。
- 上書きしたいときの代替:
  1. **セレクタの詳細度を上げる**（例: `#app .btn-footer-nav`）
  2. **ルールの記述順**（後に書いた方が勝つ）
  3. **@layer overrides** にそのルールを移す（レイヤー順で制御）

---

## 7. Stylelint ルール（守るべきこと）

| ルール | 内容 |
|--------|------|
| **declaration-no-important** | `!important` 禁止 |
| **declaration-block-no-duplicate-properties** | 同一ブロック内で同じプロパティを 2 回書かない（例: `min-width` の二重指定禁止） |
| **block-no-empty** | 空の `{ }` を書かない |

- 修正前に `npm run lint`（または Stylelint の実行）でエラーを出さないようにする。
- 詳細度の違反が多いため `no-descending-specificity` は無効だが、**新規で書くときはセレクタの詳細度をなるべく低く・単純に**する。

---

## 8. Tailwind の使い方

### 8.1 方針

- **既存の app.css / layout / components を一括で Tailwind に書き換えない。**
- **トークンと Tailwind の theme は一致**させている（`tailwind.config.js` の `theme.extend` で `tokens.css` の変数を参照）。
- **新規のマークアップ・余白・レイアウト**では、Tailwind のユーティリティ（`flex`, `gap-4`, `p-2`, `text-sm` など）の併用を検討する。

### 8.2 新規でクラスを書くとき

- 既存の BEM クラス（例: `.app-menubar__icon`）はそのままコンポーネント用として維持してよい。
- レイアウトや余白だけ Tailwind に寄せる場合は、`class="flex gap-4 p-2"` のように HTML にユーティリティを足す形でよい。
- 新しい専用クラスを app.css に足す場合は、**トークン（`var(--space-4)` など）を使い、レイヤー（通常は `@layer components`）を守る。**

### 8.3 Tailwind preflight の無効化

Tailwind の preflight を無効にしている（`tailwind.config.js` で `corePlugins: { preflight: false }`）。

- **理由**: preflight の `* { border-width: 0 }` により、ホームのセクション（`.home-balance-totals` など）で指定した枠線と角丸が表示されなかったため。
- **結果**: preflight 無効化により `* { border-width: 0 }` が適用されなくなり、ホームのセクションの枠線と角丸が正しく表示されるようになった。
- **副作用**: preflight に依存していたボタン・フォーム要素などのブラウザデフォルトリセットは適用されなくなる。本プロジェクトでは `#app button` などで独自にスタイルを指定している。

---

## 9. 修正時のチェックリスト（振り返り・基準）

スタイルを触るときに、以下でセルフチェックする。

### 9.1 値を追加・変更するとき

- [ ] 色・余白・フォント・角丸・シャドウは **tokens.css の変数** を使っているか（ハードコードしていないか）
- [ ] 足りないトークンは **tokens.css に追加してから** 使っているか

### 9.2 クラス名・セレクタを書くとき

- [ ] 新規クラスは **BEM（Block__Element--Modifier）** に沿っているか
- [ ] JS で付ける状態は **`.is-*`** か
- [ ] セレクタは **必要以上に詳細にしていないか**（ID や長い子孫は避ける）

### 9.3 ファイル・レイヤーを触るとき

- [ ] **@import はファイル先頭** にまとまっているか（main.css / app.css とも）
- [ ] 新規ファイルは **layout/** か **components/** に分け、app.css で @import しているか
- [ ] そのファイルは **正しい @layer**（layout または components）で囲んでいるか

### 9.4 上書き・優先度

- [ ] **!important は使っていないか**
- [ ] 上書きは **詳細度・記述順・@layer overrides** で解決しているか
- [ ] 同一ブロック内に **同じプロパティを 2 回** 書いていないか

### 9.5 ツール

- [ ] **Stylelint** でエラーが出ていないか（`npm run lint`）
- [ ] **ビルド** が通るか（`npx vite build`）
- [ ] 必要に応じて **Prettier** でフォーマットしているか（`npm run format`）

---

## 10. 関連ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| **docs/REFACTOR_CSS_PLAN.md** | リファクタの全体計画・フェーズ・実施結果 |
| **docs/CSS_NAMING_CONVENTIONS.md** | 命名規約の詳細（BEM・状態クラス・セレクタの書き方） |
| **.stylelintrc.cjs** | Stylelint の設定 |
| **tailwind.config.js** | Tailwind の theme（tokens との対応） |
| **src/styles/tokens.css** | 利用可能なトークン一覧 |

---

## 11. まとめ（一言で）

- **トークンで値、BEM と .is-* で名前、レイヤーで役割、!important は使わない。@import は先頭。新規は Tailwind も検討。**  
修正のたびにこのドキュメントとチェックリストで振り返ると、スタイルが崩れずにきれいなまま保てます。
