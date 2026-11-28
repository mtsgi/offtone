# Local-first データとフォルダー復旧

## IndexedDB v1 / v2（Issue #8）

`offtone` の v1 `settings` ストアと `music-directory` キーはそのまま保持する。v2 は `roots`（キー `id`、保存済みディレクトリーハンドル）と `tracks`（キー `id`、`rootId` インデックス）を追加する。楽曲レコードはルート ID、相対パス、サイズ、最終更新日時、任意のメタデータ、解析バージョン、任意の `artworkRef` を持つ。音声ファイルの内容は保存しない。

v1 からの upgrade はストア追加だけを同一 upgrade トランザクションで行う。既存ハンドルは変更しない。復元してスキャンが成功した時点でルートを登録し、権限確認前にフォルダー内容を読み取ったり保存済み設定を削除したりしない。失敗時はトランザクションがロールバックされ、DB は自動削除しない。他のタブが upgrade を妨げるときは閉じて再試行する。古い接続は `versionchange` で閉じる。DB がブラウザーから消去されれば初期状態となり、選択から再構築できる。ユーザー向けの DB 初期化機能は今回用意しない。将来追加する場合は影響を明示してユーザー操作を要求する。

ルートには UUID を割り当て、保存済みルートの `isSameEntry()` による一致時に再利用する。名前のみでは一致させない。登録は同一タブ内で直列化し、Web Locks 対応ブラウザーでは他タブとも直列化する。Web Locks 非対応時に複数タブから同時登録すると重複 ID が生じる場合がある。楽曲 ID は `[rootId, 相対パス]` の JSON 表現で、区切り文字を含む名前も区別する。パスは `/` 区切りで空・`.`・`..` 要素を拒否し、大文字小文字と Unicode の違いを維持する。サイズ・日時は ID に含めない。同じ場所に別ファイルを置き換えると同じ ID となり、移動・リネームは新しい ID となる。ブラウザーのストレージ消去後は以前の ID を復元できない。ハンドルの同一性比較をブラウザーが拒否する場合も ID を再利用できない。

## メタデータの引き継ぎ（Issue #9）

`fileChanged` はサイズまたは最終更新日時の差、`metadataIsValid` はそれに加えてメタデータの存在と解析バージョンを確認する。これらはヒューリスティックであり、サイズと日時が同じ内容変更は検出できない。フォルダーの走査後にファイル情報を取得し、Worker の解析結果を `tracks` に保存する。`artworkRef` はサムネイルを保持するレコードの Track ID を指す。[音楽タグと画像キャッシュ](metadata.md)

削除済み楽曲の整理は、権限エラーや途中失敗のないルート全体のスキャン完了後にのみ、そのルートの未検出レコードと参照されない画像を整理する。部分スキャンや古い世代の結果では削除しない。画像のサムネイルは `tracks` のレコードに保存される。ライブラリの永続参照は v3 の各ストアで独立して保持する。今後のスキーマ変更はバージョンを上げ、旧バージョンからの upgrade を明示し、既存設定を保持する移行テストを追加する。

## IndexedDB v3 のライブラリ管理（Issue #43）

v3 は同じ `offtone` DB に 5 ストアを追加する。新規 DB と v1 からの更新では必要に応じて `settings`、`roots`、`tracks` も作成する。既存の設定、`music-directory` とルートのハンドル、`["playback", rootId]` のキューと再生状態、楽曲のメタデータ・アートワークはそのまま引き継ぐ。ストアと索引の作成は同じ upgrade トランザクションで行う。

| ストア            | 型                 | 主キー                                      | 索引とキー順                                                                                               |
| ----------------- | ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `favorites`       | `Favorite`         | `trackId`                                   | `byRootAddedAt` は `[rootId, addedAt]`                                                                     |
| `playlists`       | `Playlist`         | `id`（UUID）                                | `byRootUpdatedAt` は `[rootId, updatedAt]`                                                                 |
| `playlistEntries` | `PlaylistEntry`    | `id`（項目ごとの UUID）                     | `byPlaylistPosition` は `[playlistId, position]`                                                           |
| `playHistory`     | `PlayHistoryEntry` | `id`（呼び出し元が発行する再生イベント ID） | `byRootPlayedAt` は `[rootId, playedAt]`                                                                   |
| `playStats`       | `PlayStats`        | `trackId`                                   | `byRootLastPlayedAt` は `[rootId, lastPlayedAt]`、`byRootPlayCount` は `[rootId, playCount, lastPlayedAt]` |

キーや索引に含まれないフィールドは、`Playlist` の `name`・`createdAt`、`PlaylistEntry` と `PlayHistoryEntry` の `trackId`。日時はすべて Unix エポックからのミリ秒。`position` は 0 から始まる整数で、項目削除後は欠番を許容し、並べ替え時に 0 から振り直す。ルート別索引は `rootId` で範囲を限定する。時刻や回数が同じ場合は、索引カーソルの主キー降順で順序が安定する。

### 共通の呼び出し方

各 API は現在の `useLibraryStore().rootId` を第 1 引数で受け取る。フォルダーのスキャンとルート登録が成功するまで `rootId` は未設定となる。非同期操作では開始時の `rootId` を使い、結果を機能別ストアに反映する前に `rootId` と `rootRevision` が同じか確認する。個別曲の操作ではスキャン済みの `Track.id` を渡す。形式が不正な ID、一時キュー ID、別ルートの Track ID は `TypeError` になる。

各書き込みはコミット後に解決する。IndexedDB の接続・操作失敗は `StorageError`（`blocked`、`quota`、`unavailable`）で返り、失敗したトランザクションはロールバックされる。`blocked` の場合は古いタブを閉じて再試行できる。接続中に `versionchange` が届いた場合は DB 接続を閉じる。

参照の解決には、同じルートのスキャン済み `player.tracks` を Track ID で引く。キャッシュの `getTrack` はタグ解析前にも空になり得るため、曲の有無の判定には使わない。許可済みのスキャンが完了した時点で一覧に同じ ID がなければ「未検出」と扱える。権限待ち・スキャン中・スキャン失敗時は最終確認済みの一覧を保持するか、可否が未確定として扱う。これらの状態やキャッシュの整理でライブラリの永続参照が消えることはない。同じルートの同じパスに曲が戻れば参照を再利用できる。

### お気に入り（#44）

`src/lib/favorites.ts` の `getFavorite(rootId, trackId)` は未登録の場合に `undefined` を返す。`addFavorite(rootId, trackId)` は 1 つの `favorites` トランザクションで既存レコードを確認し、初回の登録日時を保持する。`removeFavorite(rootId, trackId)` は未登録の場合も成功する。`listFavorites(rootId)` は登録日時の新しい順にすべての参照を返す。

```ts
import { addFavorite, listFavorites } from "@/lib/favorites";

const { rootId, rootRevision } = library;
if (!rootId || !track.id || library.busy || library.needsPermission) return;
await addFavorite(rootId, track.id);

const favorites = await listFavorites(rootId);
if (library.rootId !== rootId || library.rootRevision !== rootRevision) return;
const tracksById = new Map(player.tracks.map((track) => [track.id, track]));
const rows = favorites.map((favorite) => ({
  favorite,
  track: tracksById.get(favorite.trackId),
}));
```

### プレイリスト（#45）

`src/lib/playlists.ts` の `listPlaylists(rootId)` は更新日時の新しい順に返す。`getPlaylist`、`renamePlaylist`、`listPlaylistEntries`、`addPlaylistEntry` は対象が指定ルートに存在しない場合に `undefined` を返す。名前は前後の空白を取り除き、空文字列なら `TypeError` を返す。

`listPlaylistEntries(rootId, playlistId)` は親のルート確認と項目取得を同じ読み取りトランザクションで行い、空のプレイリストには `[]` を返す。`addPlaylistEntry(rootId, playlistId, trackId)` は末尾へ追加し、同じ曲でも別の項目 ID を発行する。`removePlaylistEntry(rootId, playlistId, entryId)` は指定項目だけを削除する。`reorderPlaylistEntries(rootId, playlistId, entryIds)` には現在の全項目 ID を希望順に渡す。項目の増減などで有効な順序でなければ `false` を返す。追加・削除・並べ替えは項目と親の更新日時を同じトランザクションで更新する。`deletePlaylist(rootId, playlistId)` は親と所属項目を一緒に削除する。項目削除、並べ替え、プレイリスト削除は対象が存在しない場合も `false` を返す。

```ts
import {
  addPlaylistEntry,
  createPlaylist,
  listPlaylistEntries,
  reorderPlaylistEntries,
} from "@/lib/playlists";

const playlist = await createPlaylist(rootId, "移動中に聴く曲");
await addPlaylistEntry(rootId, playlist.id, firstTrackId);
await addPlaylistEntry(rootId, playlist.id, secondTrackId);
const entries = await listPlaylistEntries(rootId, playlist.id);
if (entries) {
  const order = entries.map((entry) => entry.id).reverse();
  const saved = await reorderPlaylistEntries(rootId, playlist.id, order);
  // saved が false の場合は、現在の一覧を取得し直せる。
}
```

### 再生履歴と集計（#46）

`src/lib/play-history.ts` の `recordPlay(rootId, { id, trackId, playedAt })` は履歴イベントの追加と集計の更新を同じトランザクションで行う。再生試行ごとに一意な ID を発行し、失敗後の再試行では ID と日時を再利用する。すでに記録された ID は `false` を返し、再生回数は加算しない。日時が前後して届いた場合も `lastPlayedAt` は最新の日時を保持する。

`listPlayHistory(rootId, limit?)` はイベントを日時降順で返す。`listPlayStats(rootId, order?, limit?)` は `"recent"`（既定、最終再生日時降順）と `"most-played"`（再生回数降順、同数なら最終再生日時降順）を選べる。上限を指定すると索引から必要件数までを読み取る。`getPlayStats(rootId, trackId)` は未集計なら `undefined` を返す。`clearPlayHistory(rootId)` は指定ルートの履歴と集計を同じトランザクションで削除する。現在の集計はクリア後に記録された全イベントが対象で、保持期間や保持件数上限は #46 で定義する。

```ts
import { listPlayStats, recordPlay } from "@/lib/play-history";

// 記録条件を満たしたときに一度だけ作成し、失敗時は同じ event を渡す。
const event = { id: crypto.randomUUID(), trackId, playedAt: Date.now() };
await recordPlay(rootId, event);
const recent = await listPlayStats(rootId, "recent", 20);
const mostPlayed = await listPlayStats(rootId, "most-played", 20);
```

## Dexie の判断

ネイティブ IndexedDB は依存追加と既存コードの移行が不要だが、型、トランザクション、失敗処理を自前で管理する必要がある。Dexie は型付きテーブル、トランザクション、段階的なスキーマ変更を簡潔にでき、メタデータやプレイリストが増えた際に有利だが、ランタイム依存と導入・既存データ移行の検証が増える。現段階の少数ストアではネイティブを維持し、複雑なクエリや複数ストアの操作が増えた時点で再評価する。
