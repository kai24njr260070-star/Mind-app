# Mind Signature — 実装完了版(Phase 1〜4)

「目標を分裂させ、実行できる形へ変えていく。」AI搭載の目標形成・実行支援アプリ。
企画書 v1.0 の **Phase 1(MVP)〜 Phase 4(体験の完成度)** を実装したリポジトリです。

## 実装済みの中核体験(Phase 1)

1. 最初の目標を 1 つ入力すると、星(大目標)として宇宙に表示される。
2. 入力直後に AI が中間目標候補を **2 つ**提出する(分裂)。
3. 候補の星をタップ → 片方を採用。落選候補は静かにフェードアウト(spec §3.4)。
4. 「両方採用」なら 2 つとも確定済みツリーへ接続し、それぞれ独立した枝になる。
5. AI 候補を使わず **手動入力** でも分裂できる(AI障害時のフォールバック、spec §13)。
6. 確定済みの目標ツリー(親子関係)として永続化し、再帰的に分裂を繰り返せる。
7. 未選択の AI 候補と確定済み Goals はデータ上も厳密に区別(`CandidateRecord` vs `Goal`)。

## Phase 2 — 日常利用

- **Daily Memo**(`src/MemoView.tsx`):日付付きの自由記録。検索・編集・削除、目標との相互リンク、メモからの目標化(必ずユーザー確認あり)。メモが自動で目標化されることはない(spec §5.1)。
- **Goal Calendar**(`src/CalendarView.tsx`):月表示カレンダーに各目標の期限を星で表示。完了/超過の色分け(穏やかな表現)、日ピックで期限変更・完了操作。期限超過は失敗として扱わない(spec §6.4)。
- **期限設定**:目標詳細シート(`DetailPanel.tsx`)から任意の目標に期限を設定/解除。

## Phase 3 — 適応型AI

- **Reflection**(`src/ReflectionView.tsx` + `worker/index.ts` `/api/ai/reflection`):
  - 停滞検知の文脈(期限超過・停滞目標・「難しい/分からない」系メモ)を AI へ渡し、summary + 最大3つの提案を返す。
  - 提案はすべて**承認制**。「承認して分裂する」「承認して期限を変更」を押した時だけ適用される(spec §7.4)。
  - 辞退は「失敗」として記録されない。履歴には「辞退」としてだけ残る(spec §7.3)。
  - AI 鍵が無い/失敗時は**端末内のルール判定**(`src/reflection.ts`)へフォールバックし、判定元を UI に明示。
- ホームに承認待ち提案がある場合は薄い導線バナーを表示(spec §9)。

## Phase 4 — 体験の完成度向上

- **スタートアニメーション**(`src/Startup.tsx`):
  - 初回:SCENE01〜04(約3.7秒)。遠景の星 → 中心の光と粒子 → 円環 → 星座と光の線 → ロゴ。
  - 2回目以降:約1.3秒の短縮版(発光+ロゴ)。
  - スキップボタン/画面タップで即終了。`prefers-reduced-motion` と設定画面のスキップ指定を尊重。
  - 演出終了はアプリの準備完了と無関係(読み込みを遅らせない)。
- **効果音**(`src/sound.ts`):WebAudio による短い電子音。**既定はオフ**(消音状態を尊重)。
- **データ管理**(設定画面):バックアップ書き出し(JSON)/ファイルからの復元(確認ダイアログあり)/全削除(2段階確認)。## 技術スタックと仮定

| 項目 | 選択 | 仮定/理由 |
|---|---|---|
| プラットフォーム | モバイルファースト Web | 手元環境に iOS/Android ツールチェーンが無いため。スマホブラウザ最適化で「モバイル最優先」要件を満たす |
| UI | Vite + React 18 + TypeScript / Canvas 2D | 星空の発光・パン・ピンチ・分裂演出を低負荷で描くため |
| バックエンド | Cloudflare Worker(ローカルは wrangler dev) | AI 呼び出しを必ずサーバー側に置く。ブラウザに API 鍵を出さない |
| AI | Freebuff API(OpenAI 互換, `https://freebuff.com/api/v1/paid`) | オーナー自身の `OPENAI_API_KEY` を使用。鍵が無い間は手動入力で継続 |
| 保存 | localStorage(`mind-signature-v1`) | MVP の基本データ保存。D1 への移行は Phase 2 |

## 実行方法

```bash
npm install
npm run build      # tsc && vite build → dist/
npx wrangler dev   # http://localhost:8787 で Worker+静的配信
```

### AI 候補・Reflection AI を有効化する

**方法1: 設定画面から入力(推奨)** — アプリ内「設定 → AI」でプロバイダを選び、APIキーを貼り付けて「接続テスト」。
キーはブラウザのlocalStorageにのみ保存され、リクエスト時だけヘッダでWorkerへ渡されます(サポート: OpenAI互換の chat/completions)。

| プロバイダ | 既定エンドポイント | キーの入手先 |
|---|---|---|
| Freebuff(既定) | `https://freebuff.com/api/v1/paid` | freebuff.com アカウント → Developer API |
| Groq | `https://api.groq.com/openai/v1` | console.groq.com → API Keys |
| OpenAI | `https://api.openai.com/v1` | platform.openai.com |
| Google Gemini | `generativelanguage.googleapis.com`(OpenAI互換) | Google AI Studio |
| xAI Grok | `https://api.x.ai/v1` | console.x.ai |

モデルは既定で自動選択(軽量モデルを優先)。Groq なら `llama-3.3-70b-versatile`、Gemini なら `gemini-2.5-flash`、Grok なら `grok-3-mini` などが必要に応じたフォールバックになります。明示指定もできます。

**方法2: Worker環境変数** — `.env` に `OPENAI_API_KEY=...`(Freebuffのキー)または `GROQ_API_KEY=...`(Groqのキー)を書き、`wrangler dev` を再起動。設定画面でキーを未入力のままプロバイダを選ぶと、対応する環境変数キーへフォールバックします(base URLの設定は不要)。設定画面にキーが入力されている場合はそちらを優先します。

鍵が無い/失敗した場合、UI は明示的なエラーカードを出し **手動入力で作業を続けられる**(仕様書 §13 の品質要件)。AI が生成に失敗しても中核体験は止まらない設計。

## 星の階層表現(視覚仕様)

宇宙画面では親子階層が一目で分かるよう、深さごとに星の形を変えています(spec §4.2「色・ラベル・アイコンも併用」):

| 深さ | 大きさ | 色 | 発光 | 追加マーカー | ラベル |
|---|---|---|---|---|---|
| 大目標(ルート) | 14 | 白(季節効果なしの最強発光) | 強 | **軌道リング(点線)** | 太字13px |
| 中目標 | 9.5 | シアン | 中 | 細い単リング | 12px |
| 小目標 | 7 | 淡い紫 | 弱 | なし | 11px・薄め |
| それ以降 | 5.5 | 青紫(更に薄い) | 最弱 | なし | 11px・薄め |

完了した目標は落ち着いた紫に沈み、ラベルも常に表示する(色覚特性への配慮で色だけに依存しない)。リスト表示でも ✷ / ✦ / · で大・中・小を区別します。

## プロジェクト構成

```
index.html            画面の土台
worker/index.ts       Worker(/api/ai/fission + /api/ai/reflection + 静的配信)
src/types.ts          Goal / CandidateRecord / Memo / Reflection / Settings データモデル
src/store.ts          状態管理(イミュータブル)+ localStorage 永続化 + 書き出し/復元
src/api.ts            /api/ai/* クライアント
src/reflection.ts     停滞検知とオフライン用ルール判定(spec §7.2)
src/universe/layout.ts  目標ツリー → 星の座標(周囲に子星を放射配置)
src/universe/UniverseView.tsx  宇宙画面(Canvas・パン/ピンチ/タップ選択/分裂演出)
src/FissionBar.tsx    候補・両方採用・手動入力・保留の操作バー
src/DetailPanel.tsx   目標詳細シート(分裂/完了/期限設定/親へ移動/削除)
src/MemoView.tsx      Daily Memo(検索/リンク/目標化)
src/CalendarView.tsx  Goal Calendar(月表示/期限変更/完了)
src/ReflectionView.tsx  Reflection AI(承認制の提案カード+履歴)
src/SettingsView.tsx  設定(アニメ/音/AI案内/データ管理)
src/Startup.tsx       スタートシーケンス(初回・短縮版・スキップ)
src/sound.ts          WebAudio の短い電子音(既定オフ)
src/App.tsx           画面合成・下部ナビ・起動シーケンス制御
```

## AI 動作原則との対応(spec §11)

- 候補は常に「提案」。選択された星だけを Goal 化し、落選候補は履歴に残る(§3.2)。
- Worker のシステムプロンプトは「2 候補・意味的に分離・抽象度を 1 段階下げ・不明なことは勝手に確定しない」を強制(§11)。
- Goal / 期限 / ツリーの変更はすべてユーザー操作のみ。Reflection の変更案も承認ボタンを押すまで適用されない(§7.4)。
- 期限超過・停滞は「失敗」ではなく「計画を合わせ直す対象」として扱う(§6.4, §7.1)。
- メモは独立した存在で、自動的に目標化されない(§5.1)。

## 確認方法

- `wrangler dev` → ブラウザで http://localhost:8787
  - 初回起動シーケンス → スキップ → 最初の目標入力 → 分裂(手動入力は鍵無しで動作)
  - 下部ナビで カレンダー/メモ/振り返り/設定 へ移動
  - 詳細シートで期限設定 → カレンダーに星が表示される
  - 振り返りボタン → 鍵が無ければ「端末内の簡易判定」カードが出る → 承認/辞退を確認
  - 設定 → 書き出し/復元/全削除(2段階確認)
- AI 鍵設定後:分裂候補の実生成、Reflection の AI 判定カードを確認

## 既知の未確認事項

- 実機(iOS/Android)でのピンチ/ドラッグの操作感。
- AI 鍵未設定環境のため、AI 候補・Reflection AI の実生成は鍵設定後に要確認(フォールバック動作は確認済み)。
- D1 へのデータ移行は本リポジトリの範囲外(現状 localStorage + JSON バックアップ)。

## Cloudflare への公開

このアプリは **Cloudflare Workers + Static Assets** 構成です。`wrangler.jsonc` が `main: worker/index.ts`、`assets.directory: ./dist`(バインディング `ASSETS`)を指定しており、Worker が `/api/ai/*` を処理して、それ以外は静的ファイルを返します。

### 自分の Cloudflare アカウントへ公開する

```bash
npx wrangler login     # 初回のみ(ブラウザで認証)
npm run deploy         # tsc && vite build → wrangler deploy
```

公開URLは `https://mind-signature.<あなたのサブドメイン>.workers.dev` になります。

### サーバー側に AI キーを置く場合(任意)

既定では、設定画面で入力したキーがリクエスト時だけヘッダで Worker へ渡るため、公開に秘密情報は不要です(訪問者は各自のキーを使う)。全訪問者にオーナーのキーを使わせたい場合のみ:

```bash
npx wrangler secret put GROQ_API_KEY      # または OPENAI_API_KEY
```

### ローカルで本番同等の確認

```bash
npm run preview        # build → wrangler dev (http://localhost:8787)
```

### マネージド公開(Freebuff Sites)

Sites 用のデプロイマニフェストは `freebuff-sites-build/manifest.json`(gitignore 対象)。更新手順は次のとおりです。

```bash
npm run sites:build    # build → worker を esbuild でバンドル → assets をコピー
```

生成物は `freebuff-sites-build/worker/index.js`(ESMバンドル)と `freebuff-sites-build/assets/`(dist の中身)です。これを `freebuff-sites-build/manifest.json` で指定してデプロイします。


### ビルド済みファイルをそのまま配信する場合(Cloudflare Pages / Git連携)

`npm run sites:build` を実行すると、JSとCSSをHTMLに埋め込んだ**単一ファイル**が `public-deploy/index.html` に生成されます(外部アセット参照ゼロ)。

- Cloudflare のビルド設定: ビルドコマンド `npm run sites:build` / 出力ディレクトリ `public-deploy`
- ビルドを行わない静的配信でも、`public-deploy` を配信ディレクトリに指定すればそのまま動きます
- リポジトリ直下の `index.html` は**ビルド済み単一ファイル**です(Cloudflare Pages が出力ディレクトリ指定なしでそのまま配信しても起動する形)。Vite の開発用エントリは `app.html` に分けてあり、`npm run dev` では `/app.html` が開きます
- ソースを変更したら `npm run sites:build` を実行し、`index.html` と `public-deploy/index.html` を作り直してからコミットしてください(`index.html` は生成物です)
