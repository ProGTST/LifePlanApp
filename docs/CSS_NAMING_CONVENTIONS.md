# CSS 命名規約

## 方針

- **BEM ベース**のブロック・要素・修飾子と、**状態クラス**（`.is-*`）を組み合わせる。
- 既存クラスは段階的に揃える。新規追加時はこの規約に従う。

---

## ブロック（Block）

- ケバブケース: `block-name`
- 例: `app-menubar`, `app-header`, `data-table`, `modal-overlay`, `transaction-history-search`

---

## 要素（Element）

- `Block__element`（アンダースコア 2 本）
- 例: `app-menubar__icon`, `app-menubar__title`, `data-table__cell`

※ 既存の `block-element`（ハイフン）も許容し、リファクタ時に `__` に寄せる。

---

## 修飾子（Modifier）

- `Block--modifier` または `Block__element--modifier`
- 見た目やバリアントを表す（固定のバリエーション）
- 例: `schedule-view-summary--left`, `transaction-entry-submit--register`, `btn-header-add`

---

## 状態クラス（State）

- **JS で付与・削除される状態**は `.is-*` を使う。
- 複数要素で共通: `.is-visible`, `.is-active`, `.is-hidden`, `.is-current`, `.is-disabled`, `.is-selected`, `.is-empty`
- 例: `.app-header-left.is-visible`, `.sidebar-menu-item.is-current`, `.modal-overlay.is-visible`

※ 修飾子（`--current`）と状態（`.is-current`）が両方ある場合は、状態を `.is-current` に統一する。

---

## セレクタの書き方

- 状態: `.block.is-current { }` のようにブロック＋状態クラスで指定する。
- 修飾子: `.block--modifier { }` のまま。
- 要素: `.block__element { }`。状態と組み合わせる場合は `.block__element.is-active { }`。

---

## 参照

- リファクタ全体: `docs/REFACTOR_CSS_PLAN.md` の「1.4 命名規則の統一」
