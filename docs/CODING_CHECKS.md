# コーディングチェック実施体制

Tauri（Rust + フロント）向けのフォーマット・静的解析・セキュリティ・CI の手順です。

## 1. Rust フォーマット（rustfmt）

- **インストール**: `rustup component add rustfmt`
- **実行**: `cargo fmt --all`（`src-tauri` で実行、またはリポジトリルートで `cargo fmt -p life-plan-gant --all`）
- **CI用チェック**: `cargo fmt --all -- --check`
- **設定**: `src-tauri/rustfmt.toml`（max_width=100, tab_spaces=4, edition=2021）

## 2. Rust 静的解析（Clippy）

- **インストール**: `rustup component add clippy`
- **実行**: `cargo clippy --all-targets --all-features -- -D warnings`（必ず `-D warnings` で警告をエラー化）
- **設定**: `src-tauri/clippy.toml`（too-many-arguments-threshold=5）

## 3. セキュリティチェック（cargo-audit）

- **インストール**: `cargo install cargo-audit`（下記「cargo install が失敗する場合」を参照）
- **実行**: `cargo audit`（`src-tauri` で実行）

## 4. 依存関係ポリシー（cargo-deny）

- **インストール**: `cargo install cargo-deny`（下記「cargo install が失敗する場合」を参照）
- **実行**: `cargo deny check`（`src-tauri` で実行）
- **設定**: `src-tauri/deny.toml`（advisories / bans / licenses / sources）

## 5. フロント Lint（ESLint）

- **セットアップ**: `npm install` で devDependencies を導入済み
- **実行**: `npm run lint`（`src` 配下の TypeScript を対象）
- **設定**: `eslint.config.js`（Flat Config + typescript-eslint）

## 6. Git pre-commit hook

- **ファイル**: `.git/hooks/pre-commit`
- **実行権付与**（Git Bash または WSL）:
  ```bash
  chmod +x .git/hooks/pre-commit
  ```
- コミット前に Rust（fmt / clippy / audit / deny）とフロント（ESLint）を実行し、いずれか失敗するとコミットを中止します。

**pre-commit で「build-script-build が見つかりません」が出る場合（Windows）**  
多くの場合、Windows Defender が `target` 内のビルド成果物（exe）をスキャン中に削除しています。**まず Defender 除外を追加してから**クリーンビルドし、再コミットしてください。

1. **Defender の除外を追加する（必須）**  
   **PowerShell を管理者として実行**し、次を実行してください。
   ```powershell
   cd d:\dev\DevEnv\local\LifePlanApp
   .\scripts\add-defender-exclusion.ps1
   ```
   リポジトリルートと `src-tauri\target` が除外に追加されます。

2. **除外が有効か確認する**  
   PowerShell で次を実行し、プロジェクトのパス（`LifePlanApp` や `target`）が一覧に含まれるか確認してください。
   ```powershell
   Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
   ```
   会社のポリシーで Defender が一元管理されている場合は除外が反映されないことがあります。

3. **クリーンビルドしてから再コミット**
   ```bash
   cd src-tauri
   cargo clean
   cd ..
   ```
   その後、もう一度コミットしてください。

**どうしても解消しない場合**  
Defender を変更できない環境では、pre-commit の Clippy だけスキップしてコミットし、CI で Clippy を確認する方法があります。下記「Rust Clippy をスキップする」を参照。

**Rust Clippy をスキップしてコミットする（緊急時のみ）**  
環境要因で Clippy だけ通らない場合、スキップできます（CI では通常どおり Clippy が走ります）。

- **IDE からコミットする場合（推奨）**  
  リポジトリルートに空ファイル `.skip-clippy` を作成する。pre-commit は Clippy をスキップする。`.skip-clippy` は .gitignore 済みなのでコミットされない。
  ```powershell
  New-Item -Path .skip-clippy -ItemType File -Force
  ```
  その後、Cursor や VS Code の「コミット」から通常どおりコミットできる。不要になったら `.skip-clippy` を削除する。

- **コマンドラインでその回だけスキップ**  
  - Git Bash / WSL: `SKIP_CLIPPY=1 git commit -m "your message"`
  - PowerShell: `$env:SKIP_CLIPPY=1; git commit -m "your message"`

## 7. GitHub Actions（CI）

- **ワークフロー**: `.github/workflows/ci.yml`
- **トリガー**: `push` / `pull_request`
- **内容**: Rust（fmt / clippy / audit / deny）＋ Node 20 で `npm ci` と `npm run lint`

## リポジトリルートから一括実行例

```bash
# Rust のみ（src-tauri に移動して実行）
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo audit
cargo deny check
cd ..

# フロントのみ
npm run lint
```

## cargo install が「アクセスが拒否されました」で失敗する場合（Windows）

**A. バイナリを直接配置する（いちばん確実）**  
ビルドをスキップして、GitHub から Windows 用 exe を取得して使う方法です。

**自動で取得する（推奨）**  
PowerShell で次を実行すると、`cargo-audit` と `cargo-deny` の Windows 用バイナリをダウンロードして `%USERPROFILE%\.cargo\bin` に置きます。

```powershell
cd d:\dev\DevEnv\local\LifePlanApp
powershell -ExecutionPolicy Bypass -File .\scripts\download-cargo-tools.ps1
```

終了後、新しいコマンドプロンプトで `cargo audit --version` と `cargo deny --version` を実行して確認してください。

**手動で配置する**  
1. **cargo-audit**: [rustsec/rustsec の Releases](https://github.com/rustsec/rustsec/releases) で `cargo-audit-*-x86_64-pc-windows-msvc-*.zip` をダウンロード → 解凍して **cargo-audit.exe** を `%USERPROFILE%\.cargo\bin` にコピー。  
2. **cargo-deny**: [EmbarkStudios/cargo-deny の Releases](https://github.com/EmbarkStudios/cargo-deny/releases) で `cargo-deny-*-x86_64-pc-windows-msvc.tar.gz` をダウンロード → 解凍して **cargo-deny.exe** を `%USERPROFILE%\.cargo\bin` にコピー。  
3. `PATH` に `.cargo\bin` が含まれていれば、`cargo audit` / `cargo deny check` が使えます。

---

**B. cargo install で入れる場合（Defender 除外をしてから）**

1. **C:\Windows\System32 で実行しない**  
   ```cmd
   d:
   cd d:\dev\DevEnv\local\LifePlanApp
   ```
   のように、ドライブとプロジェクト（またはユーザー）フォルダに移動してから実行する。

2. **Windows Defender の除外を追加する**  
   `cargo install` のビルド先が Defender にブロックされていることがあります。  
   **PowerShell を管理者として実行**し、次を実行する（既存の `add-defender-exclusion.ps1` に `.cargo-install-build` と `.cargo-tmp` の除外を追加済み）:
   ```powershell
   cd d:\dev\DevEnv\local\LifePlanApp
   .\scripts\add-defender-exclusion.ps1
   ```
   終了後、**通常のコマンドプロンプト**を開き直して次へ。

3. **インストールスクリプトを実行する**  
   ```cmd
   d:
   cd d:\dev\DevEnv\local\LifePlanApp
   scripts\install-cargo-tools.cmd
   ```

4. まだ「アクセスが拒否されました」が出る場合は、**A. バイナリを直接配置する**で進めてください。
