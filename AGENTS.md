# 開発ルール(Mind Signature)

## 完了前に必ずGitHubへpushする

このプロジェクトでは「開発が終わった」=「リモートにpush済み」と定義する。
機能追加・修正・検証が終わったら、完了報告の**前に**必ず以下を実行すること。

1. 検証を通す
   - `node node_modules/typescript/bin/tsc`
   - `node node_modules/vite/bin/vite.js build`
   - UI変更があれば `npx wrangler dev` で localhost 表示を確認
2. コミットする
   - `git add -A`
   - `git commit -m "<変更内容を1〜2文で>"`(Codebuff のフッターを付ける)
3. pushする
   - `git push origin main`
4. 反映を確認する
   - `git status -sb` が `## main...origin/main` で差分なし
   - `git ls-remote origin refs/heads/main` が `git rev-parse HEAD` と一致

### 守ること

- pushに失敗した場合(認証切れ・ネットワーク等)は、黙って完了扱いにせず、
  完了報告に「pushできていない」と理由付きで明記する。
- 破壊的操作(`git push --force`、履歴の書き換え、ブランチ削除)は、
  ユーザーの明示的な指示がある場合のみ行う。
- 秘密情報(`.env`、`.dev.vars`、APIキー、トークン)は絶対にコミットしない。
  `.gitignore` の除外設定を維持すること。

## リポジトリ

- remote: `https://github.com/kai24njr260070-star/Mind-app.git`
- 既定ブランチ: `main`(公開リポジトリ)
