# こむぎえん公式サイト

小平市花小金井の認可外保育施設「こむぎえん」の公式サイトです。

## 構成

- `index.html`: 公開ページ
- `admin.html`: 園向け更新画面
- `images/`: 公開画像
- `setup/gas-code.gs`: Google Apps Scriptバックエンド
- `setup/appsscript.json`: GASマニフェスト
- `robots.txt` / `sitemap.xml`: 検索エンジン設定
- `DOMAIN_MIGRATION.md`: 独自ドメイン移行手順

GitHub Pagesで配信し、お知らせ・保育日・差し替え写真はGASとGoogleスプレッドシート／Driveから取得します。

## セキュリティ

- 管理パスワードとGemini APIキーはGitHubへ保存しない。
- 秘密情報はGASのスクリプトプロパティだけに保存する。
- 管理画面はログイン後に発行される一時トークンで更新する。
- 園児写真は掲載同意を確認し、管理画面側で再圧縮してメタデータを除去する。

デプロイ前に `setup/DEPLOYMENT.md` を確認してください。
