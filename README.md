# LifePlanGant

Tauri 2 + Vite + TypeScript のデスクトップアプリ用プロジェクトです。

## 必要な環境

- **Windows**: [SETUP.md](./SETUP.md) に記載の前提条件（C++ Build Tools、WebView2、Rust、Node.js）を満たしてください。
- Rust はすでにインストール済みです。未導入の場合は `winget install --id Rustlang.Rustup` で導入できます。

## 開発の進め方

```bash
# 依存関係のインストール（初回のみ）
npm install

# 開発サーバー起動（Vite + Tauri ウィンドウ）
npm run tauri dev

# 本番ビルド
npm run tauri build
```

**`cargo` が見つからない場合**: このプロジェクトの `tauri` スクリプトは、実行時に Cargo のパス（`%USERPROFILE%\.cargo\bin`）を自動で追加します。それでもエラーになる場合は、[SETUP.md](./SETUP.md) の「Rust」の項で PATH の設定を確認してください。

**「アクセスが拒否されました」が出る場合**: Windows Defender がビルド中のファイルをロックしている可能性が高いです。**Defender の除外**を追加してください。

1. **`scripts\run-add-defender-exclusion.bat` を右クリック** → **「管理者として実行」** を選ぶ（UAC で「はい」）。
2. 画面の表示どおりに除外が追加されたら、**そのウィンドウを閉じる**。
3. **通常のターミナル**（Cursor や PowerShell）で、もう一度 `npm run tauri dev` を実行。

手動で除外する場合: 「設定」→「プライバシーとセキュリティ」→「Windows セキュリティ」→「ウイルスと脅威の防止」→「設定の管理」→「除外の追加」で、次のフォルダを追加: `%USERPROFILE%\.cargo`、`%TEMP%`、プロジェクトフォルダ（`D:\dev\DevEnv\local\LifePlanGant`）。

**同じエラーが何度も出る場合**: クリーンせずに **何度か `npm run tauri dev` を繰り返す**と、1回ごとにビルドが先へ進み、やがて通ることがあります。それでも解消しない場合は **WSL2** 上で開発する方法もあります（WSL 内で Node / Rust を入れ、プロジェクトを WSL のパスで開いて `npm run tauri dev` を実行。Linux 用ウィンドウで動作します）。

**ビルドキャッシュを削除する場合**（PowerShell）:
```powershell
Remove-Item -Recurse -Force "$env:TEMP\tauri-life-plan-gant" -ErrorAction SilentlyContinue
```

## プロジェクト構成

- `src/` … フロントエンド（Vite + TypeScript）
- `src-tauri/` … Tauri（Rust）バックエンド
- `src-tauri/src/lib.rs` … コマンド（例: `greet`）の定義はここに追加

詳細は [SETUP.md](./SETUP.md) を参照してください。
