# offtone

端末内の音楽を再生する、オフライン対応 PWA です。

フォルダーを選択すると、その中の MP3・M4A・FLAC をサブフォルダーも含めて名前順に並べます。音楽ファイルはアップロードされません。

## 開発

```sh
vp install
vp run dev
vp check
vp test
vp run build
```

Vue Vapor モードと Nuxt UI を併用しています。

フォルダー選択には HTTPS または localhost と、File System Access API に対応する Chrome が必要です。
