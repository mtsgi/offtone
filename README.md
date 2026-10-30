# offtone

端末内の音楽を再生する、オフライン対応 PWA です。

フォルダーを選択すると、その中の MP3・M4A・FLAC をサブフォルダーも含めて名前順に並べます。音楽ファイルはアップロードされません。

## 開発

[公式手順](https://viteplus.dev/guide/)で Vite+ CLI をインストールしてください。プロジェクトの Vite+ は `package.json` で 1.4.0 に固定し、Node.js は `.node-version` の 24.19.0、npm は `devEngines` の 12.2.1 を使用します。CI も同じ指定と lockfile を使用します。

```sh
vp install --frozen-lockfile
vp run dev
vp check
vp test run
vp run build
```

`vp run build` は Vue SFC を含む型チェックと本番ビルドを実行します。GitHub Pages 向けには `VITE_BASE_PATH=/offtone/ vp run build` を実行します。PR では検証のみ行い、デフォルトブランチへの push または手動実行では検証成功後に Pages へデプロイします。

### Vue RC の更新

`package.json` の `vue` と Vue 本体に対応するすべての `@vue/*` override、および `vue` override を同じ RC バージョンに変更します。`vp install --package-lock-only` で lockfile を更新し、Vue 関連パッケージのバージョンが揃っていることと、無関係な更新が含まれていないことを差分で確認してください。その後、上記の frozen install・check・test・build を実行します。

Vue Vapor モードと Nuxt UI を併用しています。

フォルダー選択には HTTPS または localhost と、File System Access API に対応する Chrome が必要です。

### PWA 更新の検証

更新は待機中の Service Worker を通知し、ユーザーの操作で適用します。「あとで」を選んでも通知の入口が残ります。再生中は「更新する」の後に中断の確認が必要です。別タブが先に更新しても、再生中のタブは自動で再読み込みされません。更新後のフォルダー権限は Service Worker とは別にブラウザーが管理します。必要な場合は画面からアクセスを再許可してください。

#### 本番ビルドでのローカル確認

1. `VITE_BASE_PATH=/offtone/ vp run build` を実行し、`vp run preview -- --host 127.0.0.1` で配信する。Chrome の `http://127.0.0.1:4173/offtone/` を開き、Service Worker が登録されるまで待つ。開発サーバーでは SW が有効にならない。
2. フォルダーを選んで音楽を再生する。別のターミナルでアプリの表示内容に一時的な変更を加えて同じコマンドで再ビルドし、同じ URL で配信し続ける。DevTools の Application → Service Workers で **Update** を押す（Update on reload / Skip waiting は使わない）。
3. 更新通知が現れ、再生が続いていることを確認する。「あとで」を選び、通知を再表示する。再生中の「更新する」は確認を表示し、確認後だけ再読み込みされることを確かめる。停止中にも更新を試す。必要に応じて異なる一時変更を加えて再ビルドする。
4. 2 タブで開き、一方で更新を適用しても他方が自動再読み込みされないことを確かめる。更新後に新しい表示が出ることとフォルダー権限の復旧を確認する。
5. 一度オンラインで起動した後、DevTools の Network を Offline にし、アプリを閉じて同じ URL を再度開く。シェルが起動し、Cache Storage に音声ファイルがないことを確認する。オンラインに戻した後、新しいビルドの更新が検出されることを確認する。最後に一時変更を戻す。

#### GitHub Pages 実機確認

PR の CI は Pages にデプロイしないため、マージ後のデプロイまたは同じ `/offtone/` パスを持つ独立した検証環境で実施する。HTTPS の `https://mtsgi.github.io/offtone/` で PWA をインストールし、対応 Chrome で上記の再生・保留・確認・更新後の起動を確認する。新旧 2 バージョンを順に配信する必要がある。OS の機内モードでもインストール済み PWA を起動し、復帰後に更新を確認する。Cache Storage とネットワークを調べ、音声の複製キャッシュやアップロードがないこと、再起動後に必要ならフォルダーへのアクセスを再許可できることを確認する。ブラウザー・OS・バージョンと結果を記録する。
