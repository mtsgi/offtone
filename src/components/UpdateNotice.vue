<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { onScopeDispose } from "vue";
import { registerSW } from "virtual:pwa-register";
import { createPwaUpdate } from "../lib/pwa-update";
import { usePlayerStore } from "../stores/player";

const player = usePlayerStore();
const updater =
  import.meta.env.PROD && "serviceWorker" in navigator
    ? createPwaUpdate(registerSW, navigator.serviceWorker, window)
    : undefined;
onScopeDispose(() => updater?.dispose());
</script>

<template>
  <UContainer
    v-if="updater && (updater.state.available || updater.state.error)"
    class="w-full max-w-3xl py-3"
    aria-live="polite"
  >
    <div class="rounded-lg border border-default bg-elevated p-4">
      <template v-if="updater.state.available && !updater.state.deferred">
        <p class="font-medium">新しいバージョンを利用できます</p>
        <p v-if="player.playing" class="mt-1 text-sm">更新すると再生が中断されます。</p>
        <p v-if="updater.state.confirming" class="mt-1 text-sm">再生を中断して更新しますか？</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UButton
            v-if="!updater.state.confirming"
            :loading="updater.state.applying"
            :disabled="updater.state.applying"
            @click="updater.requestUpdate(player.playing)"
          >
            更新する
          </UButton>
          <UButton v-else @click="updater.confirmUpdate">再生を中断して更新</UButton>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="updater.state.applying"
            @click="updater.defer"
            >あとで</UButton
          >
          <UButton
            v-if="updater.state.confirming"
            color="neutral"
            variant="ghost"
            @click="updater.cancelConfirmation"
            >キャンセル</UButton
          >
        </div>
      </template>
      <UButton
        v-else-if="updater.state.available"
        color="neutral"
        variant="outline"
        @click="updater.show"
        >更新のお知らせを表示</UButton
      >
      <p v-if="updater.state.error" class="mt-2 text-sm text-error" role="alert">
        {{ updater.state.error }}
      </p>
    </div>
  </UContainer>
</template>
