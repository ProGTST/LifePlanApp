# CSS リファクタリング計画

## 目的
- デザイントークンの導入とハードコード値の排除
- 命名規則の統一（BEM ベース: Block__Element--Modifier）
- レイアウトとコンポーネントの分離、レイヤー分け
- !important の廃止
- 未使用スタイルの削除
- Stylelint / Prettier / PostCSS の導入
- Tailwind 化（思想転換：トークン＋ユーティリティ志向、段階的移行）

---

## フェーズ 1: 基盤整備（実施済み／進行中）

### 1.1 デザイントークン
- **tokens.css** を拡張
  - スペーシング: `--space-1` ～ `--space-*` (0.25rem 刻み)
  - タイポグラフィ: `--font-size-xs/sm/base/lg/xl`, `--font-weight-*`, `--line-height-*`
  - セマンティック色: 既存の `#app` 内変数をトークンから参照する形に
  - コンポーネントトークン: ボタン高さ `--btn-height-sm/md`, アイコン `--icon-size-sm/md`

### 1.2 CSS レイヤー
- `@layer layout, components, utilities, overrides;` を定義
- **layout**: .app-layout, .app-body, .view-body など画面構造
- **components**: ボタン、フォーム、テーブル、モーダルなど
- **utilities**: 汎用ヘルパー（必要に応じて）
- **overrides**: 詳細度を上げる上書き（!important の代替として優先）

### 1.3 レイアウトとコンポーネントの分離（実施済み）
- **src/styles/layout/app-shell.css**（`@layer layout`）: レイアウト・メニューバー・サイドバー・ヘッダー・メインコンテンツ・フッター
- **src/styles/layout/view.css**（`@layer layout`）: ビュー共通・main-view・view-body、ホーム/カレンダー/検索/スケジュール/勘定・カテゴリー・タグのビュー構造、デザイン画面プレビュー
- **src/styles/components/data-table.css**（`@layer components`）: データテーブル・ドラッグ・勘定共有・削除列
- **src/styles/components/modal.css**（`@layer components`）: モーダルオーバーレイ・選択モーダル・取引実績選択
- **app.css**: `@import` で上記 4 ファイルを読み込み、残り（フォーム・ボタン・色ピッカー・収支履歴・収支分析・スケジュール表など）は `@layer components` 内に集約

### 1.4 命名規則の統一（実施済み・段階的適用）
- ブロック: ケバブケースまたは BEM の Block（例: `app-menubar`, `data-table`）
- 要素: `Block__element`（例: `app-menubar__icon`）
- 修飾子・状態: `Block--modifier`, `Block.is-state`（例: `app-menubar__icon--active`, `.is-visible`）
- 状態クラスは `.is-visible`, `.is-active`, `.is-disabled` など明示的にする
- **実施内容**: `docs/CSS_NAMING_CONVENTIONS.md` を追加。サイドバーの「現在」を `--current` から `.is-current` に統一。app-menubar を BEM 化（`app-menubar__title`, `app-menubar__actions`, `app-menubar__icon`, `app-menubar__icon-inner`）。他ブロックは既存のまま、新規・修正時に規約に合わせる。

---

## フェーズ 2: ツール導入

### 2.1 Stylelint（実施済み・厳格化）
- `.stylelintrc.cjs` でルール設定
  - **有効**: `declaration-no-important`: true（エラー）、`declaration-block-no-duplicate-properties`: true、`block-no-empty`: true
  - **無効**: `no-descending-specificity`: null（違反が約180件のため、ルール順の大規模変更は見送り）
  - 重複プロパティ 3 件を修正（`min-width` の二重指定を解消）
  - 命名規則（selector-class-pattern）・プロパティ順序・色フォーマットは今後の拡張候補

### 2.2 Prettier
- `.prettierrc` に CSS のフォーマット（printWidth, singleQuote 等）を追加
- `npm run format` で CSS も整形

### 2.3 PostCSS
- `postcss.config.js` で postcss-import, autoprefixer を設定
- 必要に応じて Tailwind を追加

---

## フェーズ 3: !important の廃止

- 現状 66 箇所の `!important` を、以下のいずれで置き換え:
  1. セレクタの詳細度を上げる（例: `#app .btn-footer-nav`）
  2. ルールの記述順序の見直し（後勝ちで上書き）
  3. `@layer overrides` に移し、レイヤー順で制御
- 置き換えごとに Stylelint で `declaration-no-important` を確認

---

## フェーズ 4: 未使用スタイルの削除

- index.html / login.html および src/screens/*.ts で使用されているクラスを抽出
- PurgeCSS や stylelint-plugin-no-unused-selectors の利用、または手動で未使用セレクタを削除
- 削除時は grep でクラス名の参照を確認してから実施

### 4.1 実施結果（手動確認）

- **確認範囲**: index.html の `class="..."`、src/**/*.ts の `className` / `classList.add|remove|toggle` / `setAttribute("class"` と app.css のセレクタを照合。
- **結果**: 動的付与されるクラス（`is-active`, `is-visible`, `transaction-history-type-icon--${type}` 等）が多く、**明らかに未使用の単一クラス単位のブロックは検出されず**。削除は行わず、影響の小さい整理のみ実施した。
- **実施した整理**:
  - スケジュール集計の赤色をトークン化（`.schedule-summary-value--red` の `#b91c1c` → `var(--color-delayed-border)`）。
- **今後の削除を進める場合**: PurgeCSS の content に `index.html`, `login.html`, `src/**/*.ts` を指定して候補を出し、`transaction-history-tab--hidden` 等の状態クラスを safelist に入れたうえで削除することを推奨。

---

## フェーズ 5: Tailwind 化（思想転換）

### 5.1 方針
- **フル Tailwind への一括書き換えは行わない**（リスク・工数が大きい）
- **Tailwind の思想を取り入れた段階的移行**:
  1. デザイントークンを Tailwind の theme と揃える（spacing, colors, fontSize）
  2. 新規コンポーネントや新規画面では Tailwind ユーティリティを併用可能にする
  3. 既存 app.css はレイヤー化したうえで、Tailwind の `@layer components` で上書きまたは置き換えを少しずつ実施

### 5.2 導入手順
1. `tailwindcss`, `postcss`, `autoprefixer` を devDependencies に追加
2. `tailwind.config.js` で theme を tokens.css の変数と整合
3. エントリ CSS で `@tailwind base; @tailwind components; @tailwind utilities;` を読み込み
4. 既存 app.css は Tailwind の前に読み込み、必要なら `@layer components` 内に移行

### 5.3 命名との対応
- BEM クラス（例: `.app-menubar__icon`）はそのままコンポーネントクラスとして維持可能
- レイアウトや余白は徐々に Tailwind の `flex`, `gap`, `p-*`, `m-*` に置き換える選択肢を残す

---

## ファイル構成（目標）

```
src/styles/
  tokens.css          # デザイントークン（:root と #app のセマンティック）
  layout/
    app-shell.css     # アプリレイアウト・メニューバー・ヘッダー・フッター
    view.css          # ビュー共通・view-body
  components/
    button.css
    form.css
    data-table.css
    modal.css
    ...
  app.css             # @layer 定義 + 上記の @import（および残りの既存ルールをレイヤーに割り当て）
  login.css           # ログイン画面専用（既存のまま or 整理）
```

---

## 進め方

1. フェーズ 1 のトークン拡張・レイヤー枠組み・layout/component の分割を先行して実施
2. フェーズ 2 の Stylelint / Prettier / PostCSS を導入し、CI と pre-commit に組み込む
3. フェーズ 3 で !important を順次削減
4. フェーズ 4 はツールで候補を洗い出したうえで削除
5. フェーズ 5 は Tailwind を入れたうえで、新規部分から徐々に適用
