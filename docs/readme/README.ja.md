# Huaci · 划词

[English](../../README.md) · [简体中文](README.zh-CN.md) · **日本語** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

**Huaci — AI 翻訳とバイリンガルリーダー。** 旧称は「AI 划词翻译 / AI Translator」。2.2.0 で名称を変更しましたが、拡張機能 ID とストアの掲載先は変わりません。

ブラウザーで外国語の記事を読み、画像や PDF を翻訳できます。原文と訳文を段落ごとに並べ、訳文中の単語をクリックして別の表現を選び、記事と訳文を端末に保存できます。選択したテキストの翻訳、ページ内の領域翻訳、独立した翻訳パネルにも対応しています。自分の API キーを使うか、キー不要のクレジット制ホスト型翻訳を利用できます。

[公式サイト](https://huaci.app/) · [Chrome ウェブストア](https://chromewebstore.google.com/detail/ai-translator/hogimafgjmlpdlnepojgigjkhaccbcbj) · [Edge アドオン](https://microsoftedge.microsoft.com/addons/detail/mojcgjimlkkbohomcijkmoefpeekmohe) · [拡張機能ガイド](../../apps/extension/README.md)

## プレビュー

以下は現在の **2.2.0 開発版**を Chrome に読み込んだ実際のスクリーンショットと操作録画です。認識と翻訳には実際のモデルを使用しています。バイリンガル読書、言い換え、文字の形に沿った画像翻訳などの新機能はリリース準備中です。ストアでの公開状況は[拡張機能ガイド](../../apps/extension/README.md#account-and-credits-hosted-mode)をご覧ください。

**画像内テキストの認識と翻訳：** 文字を認識し、その形に沿って訳文を重ねます。原画像との比較、個別の訳文の編集、手動での範囲選択ができます。

![画像の文字認識、翻訳、原画像との比較、訳文の編集、範囲選択](../screenshots/image-recognition.gif)

**バイリンガル読書：** 記事本文を抽出して広告を除去し、原文と訳文を段落ごとに並べます。言い換えや表示レイアウトを選択し、記事と訳文を端末に保存できます。

![本文の抽出、対訳表示、言い換え、レイアウト変更、記事の保存](../screenshots/bilingual-reader.gif)

| バイリンガル読書 | 言い換え |
| --- | --- |
| [![バイリンガル読書](../screenshots/01-bilingual-reader.png)](../screenshots/01-bilingual-reader.png) | [![言い換え](../screenshots/02-word-alternatives.png)](../screenshots/02-word-alternatives.png) |
| **画像翻訳** | **ダークモードと保存した記事** |
| [![画像翻訳](../screenshots/04-image-translation.png)](../screenshots/04-image-translation.png) | [![ダークモードと保存した記事](../screenshots/03-reader-library.png)](../screenshots/03-reader-library.png) |
| **選択テキストの翻訳** | **ページ内の領域翻訳** |
| [![選択テキストの翻訳](../screenshots/06-selection-translation.png)](../screenshots/06-selection-translation.png) | [![ページ内の領域翻訳](../screenshots/09-region-translation.png)](../screenshots/09-region-translation.png) |
| **PDF 全体の対訳表示** | **翻訳パネル** |
| [![PDF 全体の対訳表示](../screenshots/08-pdf-translation.png)](../screenshots/08-pdf-translation.png) | [![翻訳パネル](../screenshots/07-translation-panel.png)](../screenshots/07-translation-panel.png) |

撮影環境とサンプル素材については[撮影について](../screenshots/README.ja.md)をご覧ください。撮影した画面は簡体字中国語です。各言語のドキュメントで同じ画像と GIF を使用しています。

## プロジェクト構成

1 つのリポジトリに 3 つのアプリケーションがあります。Vercel 上の HTML サイト、VPS 上のバックエンド、ブラウザー拡張機能です。

| アプリケーション | ディレクトリ | 実行環境 | 状況 |
| --- | --- | --- | --- |
| サイト | [apps/web](../../apps/web/README.md) | Vercel | 製品紹介、プライバシー、利用規約、更新履歴を 11 言語で提供。ヘッダーは app.huaci.app のログイン状態を取得 |
| バックエンド | [apps/backend](../../apps/backend/README.md) | VPS | 認証、アカウント画面、管理者画面、拡張機能 API、ゲスト試用、正確なクレジット管理、テキスト・画像のホスト型翻訳、Creem サブスクリプションの初版をデプロイ済み |
| 拡張機能 | [apps/extension](../../apps/extension/README.md) | Chrome / Edge | ストア版は 2.1.0。ソースは 2.2.0 で、バイリンガル読書、言い換え、用語の好み、文字の形に沿った画像翻訳を追加。リリース準備中 |

## ディレクトリ構成

```text
apps/
  web/
    public/          HTML、CSS、JS、素材、生成済みの各言語ページ
    i18n/            サイトの翻訳とページ生成ツール
    test/            サイト、言語切り替え、CSP のチェック
  backend/
    src/             Hono：設定、DB、認証、クレジット、メール
    ui/account/      アカウント画面（サーバーレンダリング）
    migrations/      PostgreSQL マイグレーション
    test/  deploy/   バックエンドテストと VPS デプロイ手順
  extension/
    manifest.json    Chrome 拡張機能マニフェスト
    src/             拡張機能のコードと UI。src/vendor/pdfjs は上流の pdf.js
    icons/           拡張機能アイコン
    _locales/        生成された Chrome ローカライズファイル
    i18n/            UI 翻訳、言語レジストリ、テンプレート
    scripts/         UI 文言の抽出、翻訳、ビルド用のローカルツール
    test/            拡張機能テスト
    store-assets/    ストア掲載文、スクリーンショット、宣伝素材
    package.sh       拡張機能のパッケージ化ツール
docs/                構成、技術資料、多言語 README
test/run.sh          リポジトリ全体のテスト入口
package.sh           拡張機能のパッケージ化入口
vercel.json          Vercel デプロイとセキュリティヘッダー
dist/extension/      生成された拡張機能 ZIP（コミットしない）
tools/               ローカルの撮影・実験ツール（コミットしない）
LICENSE              リポジトリのライセンス
PRIVACY.md           既存の公開プライバシーポリシーのパス
```

## ローカル開発

開発ツールには Node.js 22 以降が必要です。サイトのプレビューと拡張機能のパッケージ化には Python 3 も必要です。拡張機能の実行要件は Chrome 116 以降です。サイトと拡張機能のビルド・テストは標準ライブラリを使用し、npm 依存パッケージは不要です。バックエンドには独自の依存パッケージ（`cd apps/backend && npm ci`）とローカルの PostgreSQL が必要です。依存パッケージが未導入の場合、`npm test` はバックエンドをスキップします。

```sh
npm run dev                   # ローカルサービスを起動。Ctrl+C ですべて停止
npm test                      # サイトと拡張機能のテスト
npm run test:web              # サイトのみテスト
npm run test:extension        # 拡張機能のみテスト
npm run dev:web               # http://localhost:8788
npm run build:web             # サイトの各言語ページを生成
npm run check:web             # 生成済みサイト翻訳をチェック
npm run i18n:extension        # 拡張機能の UI 翻訳をローカルで更新
npm run check:extension       # 生成済み拡張機能翻訳をチェック
npm run package:extension     # dist/extension/ai-translation-<version>.zip
npm run package:edge          # dist/extension/ai-translation-edge-<version>.zip
npm run test:backend          # PostgreSQL の huaci_test データベースが必要
npm run migrate:backend       # バックエンドの DB マイグレーションを実行
npm run dev:backend           # http://localhost:8787 — アカウント画面
```

`npm run dev` は以下を起動します。

| サービス | アドレス |
| --- | --- |
| バックエンド：アカウント画面、拡張機能 API、Creem コールバック。起動前に未適用の DB マイグレーションを実行 | `http://localhost:8787` |
| 管理者画面：同じバックエンドプロセスでホスト名により切り替え | `http://admin.localhost:8787` |
| サイトのプレビュー | `http://localhost:8788` |
| 拡張機能の UI 翻訳を監視。このディレクトリを Chrome に読み込む | `apps/extension` |

ポートが使用中のサービスは、理由を表示してスキップします。バックエンドの起動前に `apps/backend` で `npm ci` を実行し、ローカルの PostgreSQL と `apps/backend/.env.local` を設定してください。

互換用の入口 `bash test/run.sh` と `bash package.sh` は、引き続きリポジトリのルートから実行できます。各アプリケーションのスクリプトは、それぞれのディレクトリからも実行できます。

Chrome のデベロッパーモードで「パッケージ化されていない拡張機能を読み込む」を使う場合は、リポジトリのルートではなく **`apps/extension`** を選択してください。開発版の読み込みパスを変えると ID が変わり、再設定が必要になることがあります。ストア版の更新では同じ掲載先を使用します。

拡張機能の UI 翻訳生成ツールは `apps/extension/.env.local` を優先し、なければルートの `.env.local` を使用します。プロセスの環境変数にも対応しています。既存のキーをルートのファイルから移す必要はありません。実行時の API キーは `chrome.storage.local` のみに保存されます。環境ファイルと開発用翻訳ツールは拡張機能のパッケージに含まれません。

## デプロイ

- **Vercel サイト：** Vercel のプロジェクトルートはリポジトリのルートのままにします。`vercel.json` が `apps/web` をビルドし、`apps/web/public` のみを公開します。サイト、Vercel 設定、関連するビルド入口の変更時に GitHub ワークフローが実行されます。

- **VPS バックエンド：** `apps/backend` を独立してデプロイします。アカウントサービスは `app.huaci.app` で稼働中です。ホスト型の音声・動画文字起こしは未実装ですが、認識済みの字幕はホスト型テキスト翻訳を利用できます。[デプロイ手順](../../apps/backend/deploy/README.md)をご覧ください。

- **ブラウザー拡張機能：** ストア向けに個別にパッケージ化して公開します。ZIP に含められるのは `manifest.json`、`src/`、`icons/`、`_locales/`、ルートの `LICENSE` のみです。

担当範囲、旧ディレクトリとの対応、開発の優先順位は[アーキテクチャ資料](../architecture.md)をご覧ください。リポジトリの開発ルールは [AGENTS.md](../../AGENTS.md) にあります。

[公式サイト](https://huaci.app/) · [ソースコード](https://github.com/csswork/AiTranslation)

[GPL-3.0](../../LICENSE) で公開しています。
