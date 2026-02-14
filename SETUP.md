# Tauri デスクトップアプリ 開発環境セットアップ

このドキュメントは、Windows で Tauri 2.x の開発環境を構築する手順です。

## 前提条件（Windows）

### 1. Microsoft C++ Build Tools（必須）

Tauri はネイティブビルドに **Microsoft C++ Build Tools** を使用します。未インストールだと `linker 'link.exe' not found` でビルドに失敗します。

1. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) のインストーラーをダウンロード
2. インストール時に **「C++ によるデスクトップ開発」** を選択してインストール
3. インストール後、**新しいターミナル**を開いてから `npm run tauri dev` を実行してください

### 2. WebView2

Tauri は Windows で **Microsoft Edge WebView2** で UI を表示します。

- **Windows 10 (1803 以降) および Windows 11** では標準で含まれているため、多くの場合は追加インストール不要です。
- 必要に応じて [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section) の「Evergreen Bootstrapper」をインストールしてください。

### 3. Rust

Tauri のバックエンドは Rust で書かれているため、**Rust** のインストールが必須です。

**PowerShell でインストール（推奨）:**

```powershell
winget install --id Rustlang.Rustup
```

インストール時のダイアログでは、**MSVC ツールチェーン**をデフォルトに選択してください（`x86_64-pc-windows-msvc` など）。

既に Rust を入れている場合は、MSVC をデフォルトにするには:

```powershell
rustup default stable-msvc
```

**重要:** インストール後は **ターミナル（場合によっては PC）を再起動** してから次の手順に進んでください。

### 4. Node.js（フロントエンド用）

フロントエンドに TypeScript/JavaScript を使う場合は **Node.js** が必要です。

- [Node.js](https://nodejs.org) の LTS 版をインストール
- インストール確認: `node -v` と `npm -v` でバージョンが表示されれば OK

---

## プロジェクトの作成と起動

上記の前提条件が整ったら、このフォルダで以下を実行します。

### 新規プロジェクトを作成する場合

```powershell
# プロジェクト名を指定して作成（テンプレート: vanilla = HTML/CSS/JS のみ）
npm create tauri-app@latest . -- --template vanilla

# または対話形式で作成
npm create tauri-app@latest
```

### 依存関係のインストールと開発サーバー起動

```powershell
npm install
npm run tauri dev
```

初回は Rust のビルドに数分かかることがあります。完了すると Tauri のウィンドウが開きます。

---

## 利用可能なテンプレート

- `vanilla` - HTML / CSS / JavaScript のみ（シンプル）
- `react` - React
- `vue` - Vue.js
- `svelte` - Svelte
- `solid` - SolidJS
- `angular` - Angular
- `preact` - Preact

---

## トラブルシューティング

- **Rust や cargo が認識されない**  
  ターミナルを閉じて開き直すか、PC を再起動してください。PATH に `%USERPROFILE%\.cargo\bin` が含まれているか確認してください。

- **MSVC 関連のビルドエラー**  
  「C++ によるデスクトップ開発」が入っているか確認し、`rustup default stable-msvc` を実行してください。

- **WebView2 のエラー**  
  Windows のバージョンを確認し、必要なら WebView2 Runtime を再インストールしてください。

詳細は [Tauri 公式ドキュメント](https://v2.tauri.app/start/prerequisites/) を参照してください。
