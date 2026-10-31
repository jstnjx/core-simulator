<!-- SPDX-License-Identifier: GPL-3.0-only. Native Configurator widget renderer. -->
<script setup lang="ts">
import { computed } from "vue";
import type { ActivityUserInterfaceItem } from "@/types/activity";
import { getComponentClasses } from "@/composables/components";
const props = defineProps<{ settings: ActivityUserInterfaceItem }>();
const id = computed(() => props.settings.video_stream?.id || "");
const src = computed(() => id.value ? "/rtsp-addon/media/mjpeg/" + encodeURIComponent(id.value) : "");
</script>
<template>
  <div :class="getComponentClasses('video-stream', settings)" class="video-stream-native">
    <img v-if="src" :src="src" alt="Live video stream" draggable="false"
      style="width:100%;height:100%;object-fit:cover;display:block;background:#06080b" />
    <div v-else class="video-stream-native__empty">
      <i class="fa-regular fa-video"></i>
      <span>{{ settings.video_stream?.name || 'Video Stream' }}</span>
    </div>
  </div>
</template>
<style scoped>
.video-stream-native{width:100%;height:100%;min-height:0;overflow:hidden;border-radius:inherit;background:#06080b}
.video-stream-native__empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:8px;color:inherit}
</style>
