# 独自ドメイン移行チェックリスト

独自ドメインが決まるまでは `https://komugien.github.io/` を正規URLとして維持する。

## 第一候補

`komugien.com`

- 2026-07-25のVerisign RDAP確認では未登録の可能性が高い。
- DNS応答はなかった。
- Wayback Machineの履歴確認は同日のAPI障害で完了していない。
- 購入直前に空き、過去利用履歴、商標・類似名称を再確認する。

## ドメイン確定後に変更するもの

- GitHub PagesのCustom domain設定
- ルートの `CNAME`
- `index.html` のcanonical、OGP、Twitter画像、JSON-LD URL
- `robots.txt` のSitemap URL
- `sitemap.xml` のURL
- Google Search Consoleのドメインプロパティとサイトマップ
- GoogleビジネスプロフィールのウェブサイトURL
- Instagramプロフィール等の外部リンク

## DNS

- ApexドメインはGitHub Pages公式のA/AAAAレコードへ向ける。
- `www` は `komugien.github.io` へのCNAMEにする。
- GitHub Pagesで証明書発行後、Enforce HTTPSを有効にする。

DNS値は変更時点のGitHub公式ドキュメントで再確認し、古いメモのIPアドレスをそのまま使わない。

## 公開確認

- 独自ドメインがHTTPSで表示される
- 旧GitHub Pages URLから独自ドメインへ転送される
- canonicalとJSON-LDが独自ドメインを指す
- お知らせ、写真、保育日取得が動作する
- 管理画面が検索対象外で、ログインなしでは更新できない
