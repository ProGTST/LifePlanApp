# Tauri ビルド（Windows）で「アクセスが拒否されました」が出るとき

`npm run tauri dev` や `cargo build` の途中で、次のようなエラーになることがあります。

- `Failed to clean up ... probe: アクセスが拒否されました。 (os error 5)`
- `serde_core` / `anyhow` / `thiserror` の build で `PermissionDenied`

原因の多くは、**Windows Defender（リアルタイム保護）がビルド中のファイルをスキャンしてロックする**ためです。

## 対処: ウイルス対策の除外にフォルダを追加する

1. **Windows セキュリティ** を開く  
   （タスクバーの盾アイコン、または 設定 → プライバシーとセキュリティ → Windows セキュリティ）

2. **ウイルスと脅威の防止** → **設定の管理**（または「ウイルスと脅威の防止の設定」）

3. **除外** → **除外の追加または削除** → **除外の追加** → **フォルダー**

4. 次のフォルダを**1つずつ**追加する（プロジェクトの実際のパスに合わせてください）:
   - このリポジトリのルート  
     例: `D:\dev\DevEnv\local\LifePlanApp`
   - Cargo が使うキャッシュ（任意だが入れておくと安定しやすい）  
     例: `C:\Users\<あなたのユーザー名>\.cargo`

5. 追加後、**もう一度**ビルドする:
   ```powershell
   # 既存の target を削除してから（任意）
   Remove-Item -Recurse -Force src-tauri\target -ErrorAction SilentlyContinue

   npm run tauri dev
   ```

## それでも失敗する場合

- **管理者として実行**: コマンドプロンプトや PowerShell を「管理者として実行」し、同じディレクトリで `npm run tauri dev` を試す。
- **別のプロセスを止める**: 他のターミナルや IDE で同じプロジェクトの `cargo` / `tauri` が動いていないか確認し、終了してから再実行する。
- **PC を再起動**してから、再度上記の除外設定でビルドを試す。
