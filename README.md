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
