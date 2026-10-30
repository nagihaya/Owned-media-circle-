# 公開までの手順（Manusからの移行後）

所要時間の目安：60〜90分。上から順に進めてください。パスワードや鍵は**チャット・GitHub・コードに書かず**、指定された設定画面にだけ入力します。

無料枠の条件は各社が変更することがあります（2026年10月時点で確認）。ずっと0円であることは保証できません。

| サービス | 用途 | 無料枠の主な条件 |
|---|---|---|
| TiDB Cloud（Starter） | データベース（記事・設定・画像） | 1クラスタあたり行ストレージ5GiB・月5,000万RU。超えると制限がかかる |
| Render（Free） | サイトの公開 | 15分アクセスがないと休止し、次のアクセスで起動まで30〜60秒ほどかかる |
| Google Cloud | 編集ログイン（Googleアカウント） | OAuthクライアントの作成は無料 |
| GitHub Actions | 1日3回のRSS取得・毎日の期限処理 | 公開リポジトリでは無料。60日間リポジトリの更新がないと定期実行が自動停止する |

---

## 1. データベースを作る（TiDB Cloud）

1. https://tidbcloud.com にGoogleアカウントでサインアップします。
2. 「Create Cluster」→ **Starter** を選び、リージョンは **Tokyo (ap-northeast-1)** を選びます。
3. 作成後、「Connect」を開きます。
   - Connect With：**General**
   - 「Generate Password」を押して、表示されたパスワードを控えます（一度しか表示されません）。
4. 表示される接続情報を、次の形の1行にまとめます。

   ```text
   mysql://ユーザー名:パスワード@ホスト:4000/test
   ```

   ユーザー名は `xxxxxxxx.root` の形です。パスワードに記号が含まれる場合も、そのまま入れて問題ありません（`@` `:` `/` `#` を含む場合は再生成した方が安全です）。

   これが `DATABASE_URL` です。手順3で使います。

## 2. Googleログインを用意する（Google Cloud）

1. https://console.cloud.google.com でプロジェクトを作成します（名前例：`tbiz-media`）。
2. 「APIとサービス」→「OAuth同意画面」（Google Auth Platform）を開きます。
   - アプリ名：T-Biz メディア編集
   - ユーザーの種類：**外部**
   - サポートメール・連絡先：運営のメールアドレス
   - スコープは追加不要です（ログインに必要な `openid` `email` `profile` は標準で使えます）。
   - 作成後「対象」で**本番環境に公開**にしておくと、テストユーザー登録なしで編集者がログインできます。基本スコープだけなのでGoogleの審査は通常不要です。
3. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
   - 種類：**ウェブアプリケーション**
   - 承認済みのリダイレクトURI：手順3でRenderのURLが決まってから入力します（いったん空欄で作成し、あとで追加して構いません）。
4. 表示された **クライアントID** と **クライアントシークレット** を控えます。

## 3. サイトを公開する（Render）

1. https://render.com にGitHubアカウントでサインアップします。
2. 「New」→「Blueprint」→ リポジトリ `nagihaya/Owned-media-circle-` を選び、ブランチは公開したいもの（マージ後は `main`）を選びます。`render.yaml` が読み込まれます。
3. 入力を求められる環境変数に次を入れます。

   | 名前 | 入れるもの |
   |---|---|
   | `DATABASE_URL` | 手順1で作った1行 |
   | `GOOGLE_CLIENT_ID` | 手順2のクライアントID |
   | `GOOGLE_CLIENT_SECRET` | 手順2のクライアントシークレット |
   | `TBIZ_ADMIN_EMAIL` | 最初の管理者にするGoogleアカウントのメール |
   | `TBIZ_CRON_SECRET` | 32文字以上のランダムな文字列（下の作り方参照） |
   | `TBIZ_PUBLIC_ORIGIN` | いったん空欄。URLが決まったら入力 |

   `TBIZ_SESSION_SECRET` は自動生成されます。

   ランダム文字列の作り方（パソコンのターミナルで）：

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. デプロイが終わると `https://tbiz-media-xxxx.onrender.com` のようなURLが表示されます。
5. Renderの「Environment」で `TBIZ_PUBLIC_ORIGIN` にこのURL（末尾の `/` なし）を入れて保存します（自動で再起動します）。
6. Google Cloudの手順2-3に戻り、「承認済みのリダイレクトURI」に次を追加します。

   ```text
   https://tbiz-media-xxxx.onrender.com/auth/callback
   ```

7. 公開URLの `/health` を開き、`{"ok":true}` と表示されれば、データベースにつながっています。

## 4. 最初の管理者としてログイン

1. サイト右上の「編集ログイン」→「Googleでログイン」。
2. `TBIZ_ADMIN_EMAIL` に入れたアカウントでログインすると、自動で管理者になります（管理者がまだ1人もいない場合だけ）。
3. 編集画面の「編集者管理」から、ほかのメンバーのメールアドレスを追加できます。追加された人は、そのアドレスのGoogleアカウントでログインすると編集者になります。

## 5. 定期実行を設定する（GitHub Actions）

1. GitHubのリポジトリ →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」で2つ登録します。

   | 名前 | 値 |
   |---|---|
   | `TBIZ_SITE_URL` | 公開URL（`https://tbiz-media-xxxx.onrender.com`） |
   | `TBIZ_CRON_SECRET` | Renderに入れたものと同じ値 |

2. 「Actions」タブ →「scheduled」→「Run workflow」で `rss` を選んで実行し、緑のチェックになれば完了です。編集画面の「運用設定」に実行結果が表示されます。

定期実行は**デフォルトブランチ（通常 `main`）のワークフローだけ**が動きます。作業ブランチを `main` にマージしてから有効になります。

## 6. 公開後に入力する情報

編集画面から入力できます。

- 正式サイト名・Instagram・T-BizのURL・ロゴ・スライド写真
- noteマガジンのRSS URL（末尾 `/rss`）。過去記事はURLで取り込み
- Googleフォーム4枠のURL
- ポリシーの制定日

## 困ったとき

| 症状 | 確認すること |
|---|---|
| `/health` が `{"ok":false}` | `DATABASE_URL` のホスト・ポート（4000）・パスワード。TiDBの「Networking」で公開エンドポイントが有効か |
| ログインで「許可されていません」 | `TBIZ_PUBLIC_ORIGIN` が公開URLと完全に一致しているか（`https://`あり、末尾`/`なし） |
| Googleで「redirect_uri_mismatch」 | Google Cloud のリダイレクトURIが `公開URL/auth/callback` になっているか |
| ログインできたが編集画面に入れない | 管理者のメールが `TBIZ_ADMIN_EMAIL` と一致しているか。2人目以降は管理者が「編集者管理」で追加 |
| 初回表示が遅い | Render無料プランの休止からの起動です（30〜60秒）。有料プラン（月7ドル〜）で解消します |

## ローカルで動かす（開発者向け）

Node.js 24 と MySQL（またはMariaDB）を用意し、ローカルのDBに対して実行します。DBのホストが `127.0.0.1` / `localhost` の場合に限りTLSなしで接続します（それ以外は必ず証明書を検証します）。

```bash
npm ci
```

```bash
export DATABASE_URL='mysql://user:pass@127.0.0.1:3306/tbiz_local' TBIZ_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" PORT=3000 TBIZ_BIND_HOST=127.0.0.1
```

```bash
npm run migrate && npm start
```

コードの検証は `npm run check` と `npm test` です。
