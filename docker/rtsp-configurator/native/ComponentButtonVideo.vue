<!-- SPDX-License-Identifier: GPL-3.0-only. Static Configurator placeholder for the Video Stream widget. -->
<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useElementSize } from "@vueuse/core";
import type { ActivityUserInterfaceItem } from "@/types/activity";
import { getComponentClasses } from "@/composables/components";

const props = defineProps<{ settings: ActivityUserInterfaceItem }>();

// Match the built-in Media Player widget's responsive layout and classes.
// The Configurator is an editor, not a viewer: no RTSP/MJPEG request is made.
const videoStream = useTemplateRef<HTMLDivElement>("videoStream");
const { width, height } = useElementSize(videoStream);

const mainClasses = computed(() => {
  const classes = getComponentClasses("media-player", props.settings).join(" ");
  return width.value > 0 && height.value / width.value < 0.6
    ? "ui-component--media-player--compact " + classes
    : classes;
});

const displayName = computed(() =>
  props.settings.video_stream?.name?.trim() || "Video Stream",
);
</script>

<template>
  <div ref="videoStream" :class="mainClasses">
    <div class="ui-component--media-player__cover">
      <i class="fa-regular fa-video"></i>
    </div>
    <div class="ui-component--media-player__main">
      <h1 class="ui-component--media-player__title">
        {{ displayName }}
      </h1>
      <p class="ui-component--media-player__source">
        Video Stream
      </p>
      <div class="ui-component--media-player__progress">
        <div class="ui-component--media-player__progress__line">
          <span></span>
        </div>
        <div class="ui-component--media-player__progress__time">
          <span class="ui-component--media-player__progress__time__value">Preview</span>
          <span class="ui-component--media-player__progress__time__value">RTSP</span>
        </div>
      </div>
    </div>
  </div>
</template>
