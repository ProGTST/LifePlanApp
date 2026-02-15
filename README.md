# LifePlanGant

Tauri 2 + Vite + TypeScript のデスクトップアプリ用プロジェクトです。収支データ（CSV）の読み書きは Node.js（Fastify）の API サーバー経由で行います。

## 必要な環境

- **Windows**: [SETUP.md](./SETUP.md) に記載の前提条件（C++ Build Tools、WebView2、Rust、Node.js）を満たしてください。
- Rust はすでにインストール済みです。未導入の場合は `winget install --id Rustlang.Rustup` で導入できます。

## 起動方法

**CSV の読み書きは API サーバー経由のため、利用時は必ず先に API サーバーを起動してください。**

### 1. 依存関係のインストール（初回のみ）

```bash
npm install
```

### 2. API サーバーを起動する

別ターミナルで以下を実行し、起動したままにします。

```bash
npm run server
```

- デフォルトでは **ポート 3000** で待ち受けます。
- ポートが使用中のときは、別ポートを指定して起動できます（PowerShell の例）:
  ```powershell
  $env:PORT=3001; npm run server
  ```
  その場合は、プロジェクトルートに `.env` を作成し `VITE_DATA_API_BASE=http://localhost:3001` を設定してください（Vite を再起動）。

### 3. フロントを起動する

- **ブラウザで見る場合**  
  ```bash
  npm run dev
  ```
  ブラウザで `http://localhost:5173` を開きます。API へのリクエストは Vite のプロキシで `http://localhost:3000` に転送されます。

- **Tauri アプリ（デスクトップ）で使う場合**  
  ```bash
  npm run tauri dev
  ```
  同上、API サーバーを先に起動しておいてください。

- **スマホのブラウザから同じ LAN で見る場合**  
  1. 上記のとおり API サーバーを起動する。  
  2. `npm run dev:host` で Vite を起動する。  
  3. PC の IP アドレスを確認し、スマホのブラウザで `http://<PCのIP>:5173` を開く。

### 起動手順のまとめ

| 用途           | 手順                                                                 |
|----------------|----------------------------------------------------------------------|
| ブラウザで利用 | ターミナル1: `npm run server` → ターミナル2: `npm run dev` → ブラウザで http://localhost:5173 |
| Tauri で利用   | ターミナル1: `npm run server` → ターミナル2: `npm run tauri dev`     |
| スマホで表示   | ターミナル1: `npm run server` → ターミナル2: `npm run dev:host` → スマホで http://&lt;PCのIP&gt;:5173 |

## 開発の進め方

```bash
# 開発サーバー起動（Vite + Tauri ウィンドウ）
# ※ 上記「起動方法」のとおり、先に npm run server を起動すること
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
