# README のスクリーンショットと GIF

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

撮影日：2026-11-13。拡張機能はソースから読み込んだ **2.2.0 開発版**です。このバージョンがストアで公開済みという意味ではありません。

macOS 上の Chrome for Testing 150 を使用し、本リポジトリの `apps/extension` を独立したブラウザープロファイルに読み込みました。画面言語は簡体字中国語です。翻訳には DeepSeek（`deepseek-flash`）を使用しています。画像認識、記事翻訳、言い換えは拡張機能の実際のリクエスト経路を通り、その実行時にモデルが返した結果を表示しています。

PNG はブラウザーから直接取得した 1280 × 800 の画像です。GIF は Chrome の実際の録画フレームをタイムスタンプに基づき 1000 × 625、10 fps、無限ループでエンコードしたものです。圧縮対象は解像度とパレットのみです。撮影の自動化では右クリックメニューと同じメッセージまたはスクリプト注入の処理を起動します。ブラウザー標準の右クリックメニュー自体は GIF に含まれません。

## 操作デモ

| ファイル | 操作 |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | 日本語メニューを認識 → 中国語訳を重ねる → 原画像と比較 → 個別の訳文編集を開く → 範囲を選択 |
| [bilingual-reader.gif](bilingual-reader.gif) | 記事をスキャン → 広告を除去して対訳表示 → 言い換え → 上下／並列のレイアウト切り替え → 保存 → ダークモード |

## スクリーンショット

| ファイル | 場面 |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | 原文と訳文を段落ごとに並列表示 |
| [02-word-alternatives.png](02-word-alternatives.png) | 選択した語句、対応する原文、候補、自分で入力する置き換え |
| [03-reader-library.png](03-reader-library.png) | ダークモードと端末に保存した記事 |
| [04-image-translation.png](04-image-translation.png) | 日本語メニューの認識と文字の形に沿った訳文表示 |
| [05-image-editing.png](05-image-editing.png) | 画像内の訳文を個別編集、文字サイズの調整、再翻訳 |
| [06-selection-translation.png](06-selection-translation.png) | 原文を展開した選択テキスト翻訳ポップアップ |
| [07-translation-panel.png](07-translation-panel.png) | 独立した翻訳パネル |
| [08-pdf-translation.png](08-pdf-translation.png) | PDF の原文と訳文を並列表示。ローカル解析、全 2 ページ |
| [09-region-translation.png](09-region-translation.png) | ページ内領域のその場翻訳とホバー時のボタン |

## サンプル素材

記事、日本語メニュー画像、PDF は、本リポジトリにあるローカルのサンプル素材を使用しています。媒体名、著者、日付、PDF 内のテストデータは例示用で、実際のニュースや性能評価ではありません。元の記事には広告のプレースホルダーがあり、読書ページには拡張機能が広告を除去して抽出した本文が表示されます。メニューの文字はモデルが認識・翻訳し、拡張機能が中国語の訳文を描画します。

撮影スクリプト、中間フレーム、ブラウザープロファイルは、Git の管理対象外のローカル `tools/capture/` に保存され、拡張機能パッケージには含まれません。このディレクトリには完成した素材と説明のみを保存しています。
