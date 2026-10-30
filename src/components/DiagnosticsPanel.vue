<script setup vapor lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import { diagnostics } from "../lib/diagnostics";

const version = ref(0);
const message = ref("");
const unsubscribe = diagnostics.subscribe(() => version.value++);
onScopeDispose(unsubscribe);
const enabled = computed(() => {
  void version.value;
  return diagnostics.isEnabled();
});
const json = computed(() => {
  void version.value;
  return JSON.stringify({ version: 1, events: diagnostics.snapshot() }, null, 2);
});

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(json.value);
    message.value = "コピーしました。";
  } catch {
    message.value = "コピーできませんでした。テキストを選択してコピーしてください。";
  }
}
function download(): void {
  const url = URL.createObjectURL(new Blob([json.value], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "offtone-diagnostics.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
</script>

<template>
  <details class="mx-auto w-full max-w-3xl px-4 py-3 text-sm">
    <summary class="cursor-pointer">診断ログ</summary>
    <p class="my-2">
      記録はこの画面のメモリ内のみ、最大 500
      件です。曲名・パス・音声データは記録しません。再読み込みで消えます。
    </p>
    <div class="flex flex-wrap gap-2">
      <button class="rounded border px-2 py-1" @click="diagnostics.setEnabled(!enabled)">
        {{ enabled ? "記録を停止" : "記録を開始" }}
      </button>
      <button
        class="rounded border px-2 py-1"
        :disabled="!enabled"
        @click="diagnostics.record('marker')"
      >
        操作時刻を記録
      </button>
      <button class="rounded border px-2 py-1" @click="copy">コピー</button>
      <button class="rounded border px-2 py-1" @click="download">JSON 保存</button>
      <button class="rounded border px-2 py-1" @click="diagnostics.clear()">消去</button>
    </div>
    <p aria-live="polite">{{ message }}</p>
    <textarea
      class="mt-2 h-40 w-full rounded border p-2 font-mono text-xs"
      readonly
      :value="json"
      aria-label="診断ログ JSON"
    />
  </details>
</template>
