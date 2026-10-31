// SPDX-License-Identifier: GPL-3.0-only
// Patch the published Unfolded Circle Web Configurator Vue sources BEFORE Vite
// compilation. No runtime DOM cloning, MutationObserver, or Shadow DOM editor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || '/build');
const files = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
function once(value, original, replacement, file) {
  const first = value.indexOf(original);
  if (first < 0 || value.indexOf(original, first + original.length) >= 0)
    throw new Error('Upstream source mismatch in ' + file + ': ' + original.slice(0, 100));
  return value.replace(original, replacement);
}
function edit(file, transform) {
  const source = read(file);
  const output = transform(source, file);
  if (source === output) throw new Error('No change applied to ' + file);
  write(file, output);
}
function copy(source, target) {
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.copyFileSync(path.join(files, source), path.join(root, target));
}
copy('ComponentButtonVideo.vue', 'src/components/ui/ComponentButtonVideo.vue');
copy('videoStreams.ts', 'src/composables/videoStreams.ts');

edit('src/types/activity.ts', (s, f) => {
  s = once(s, '    | "select";', '    | "select"\n    | "video_stream";', f);
  s = once(s, '  media_player_id?: string;',
    '  media_player_id?: string;\n  video_stream?: { id?: string; name?: string; url?: string; width?: number; fps?: number };', f);
  return s;
});

edit('src/composables/components.ts', (s, f) => {
  s = once(s,
    'import ComponentButtonSelect from "@/components/ui/ComponentButtonSelect.vue";',
    'import ComponentButtonSelect from "@/components/ui/ComponentButtonSelect.vue";\nimport ComponentButtonVideo from "@/components/ui/ComponentButtonVideo.vue";', f);
  s = once(s, '  console.warn("Unknown component type: " + type);',
    '  if (type === "video_stream") return ComponentButtonVideo;\n  console.warn("Unknown component type: " + type);', f);
  s = once(s, '    },\n  ] as ActivityUserInterfaceItem[];',
    '    },\n    {\n      type: "video_stream", text: "Video Stream",\n      video_stream: { name: "Video Stream", url: "", width: 640, fps: 24 },\n      size: { width: 2, height: 2 }, location: { x: 0, y: 0 },\n    },\n  ] as ActivityUserInterfaceItem[];', f);
  return s;
});

edit('src/components/elements/widget/AddWidget.vue', (s, f) => {
  s = once(s,
    '    const mediaMinHeight = Math.ceil(\n      props.gridDimensions.widgetMeta.mediaPlayerMinHeight /\n        (props.gridDimensions.height / gridRows),\n    );',
    '    const mediaMinHeight = Math.max(1, Math.ceil(gridRows / 4));', f);
  s = once(s,
    '  } else if (item.type == "slider") {',
    '  } else if (item.type === "video_stream") {\n' +
    '    uiItem.size.width = Math.min(2, gridCols);\n' +
    '    uiItem.size.height = Math.min(2, gridRows);\n' +
    '  } else if (item.type == "slider") {', f);
  s = once(s,
    '      <!-- <div v-if="types[2]',
    '      <div v-if="entityType === \'activity\' && types[7] && types[7].type === \'video_stream\'"\n' +
    '        class="widget-card" @click="selectType(types[7])">\n' +
    '        <div class="widget-card__image"><i class="fa-regular fa-video"></i></div>\n' +
    '        <h4 class="widget-card__title">Video Stream</h4>\n' +
    '        <span class="widget-card__description">Live RTSP camera feed</span>\n' +
    '      </div>\n' +
    '      <!-- <div v-if="types[2]', f);
  return s;
});

edit('src/components/ui/GridItemEdit.vue', (s, f) => {
  s = once(s,
    'const emit = defineEmits(["close", "delete", "change", "copy"]);',
    'const emit = defineEmits(["close", "delete", "change", "copy"]);\n' +
    'const videoStreamName = ref(String(props.settings.video_stream?.name || "Video Stream"));\n' +
    'const videoStreamUrl = ref("");\n' +
    'const videoStreamWidth = ref(Number(props.settings.video_stream?.width || 640));\n' +
    'const videoStreamFps = ref(Number(props.settings.video_stream?.fps || 24));\n' +
    'const videoStreamError = ref("");\n' +
    'function updateVideoStream() {\n' +
    '  if (!props.settings.video_stream?.id && !/^(rtsp|rtsps):\\/\\//i.test(videoStreamUrl.value.trim())) {\n' +
    '    videoStreamError.value = "Enter an RTSP or RTSPS source URL"; return;\n' +
    '  }\n' +
    '  videoStreamError.value = "";\n' +
    '  localSettings.value.video_stream = {\n' +
    '    ...localSettings.value.video_stream,\n' +
    '    name: videoStreamName.value.trim() || "Video Stream",\n' +
    '    width: Math.max(160, Math.min(1280, Number(videoStreamWidth.value) || 640)),\n' +
    '    fps: Math.max(1, Math.min(30, Number(videoStreamFps.value) || 24)),\n' +
    '    ...(videoStreamUrl.value.trim() ? { url: videoStreamUrl.value.trim() } : {}),\n' +
    '  };\n' +
    '  localSettings.value.text = localSettings.value.video_stream.name;\n' +
    '  emitChange();\n' +
    '}\n', f);
  s = once(s, 'const disableCopy = computed(() => {',
    'const disableCopy = computed(() => {\n  if (props.settings.type === "video_stream") return true;', f);
  s = once(s, '        <div\n          v-if="localSettings.type === \'icon\'"',
    '        <div v-if="localSettings.type === \'video_stream\'" class="widget-popup__field">\n' +
    '          <UCInput v-model="videoStreamName" label="Name" :full-w="true" @submit="updateVideoStream" />\n' +
    '          <UCInput v-model="videoStreamUrl" label="RTSP URL" :full-w="true" :type="\'text\'"\n' +
    '            :description="props.settings.video_stream?.id ? \'Leave blank to keep the saved camera URL\' : \'rtsp://user:pass@camera/live\'"\n' +
    '            @submit="updateVideoStream" />\n' +
    '          <div class="widget-popup__field widget-popup__field--size">\n' +
    '            <label>Video width (px)</label><UCStepper v-model="videoStreamWidth" :min="160" :max="1280" @change="updateVideoStream" />\n' +
    '          </div>\n' +
    '          <div class="widget-popup__field widget-popup__field--size">\n' +
    '            <label>Frame rate (FPS)</label><UCStepper v-model="videoStreamFps" :min="1" :max="30" @change="updateVideoStream" />\n' +
    '          </div>\n' +
    '          <p v-if="videoStreamError" class="widget-popup__error">{{ videoStreamError }}</p>\n' +
    '          <button class="button button--primary" type="button" @click="updateVideoStream">\n' +
    '            {{ props.addItem ? "Add Video Stream" : "Save Video Stream" }}\n' +
    '          </button>\n' +
    '        </div>\n' +
    '        <div\n          v-if="localSettings.type === \'icon\'"', f);
  return s;
});

edit('src/components/activity/ActivityRemote.vue', (s, f) => {
  s = once(s,
    'import { getComponent } from "@/composables/components";',
    'import { getComponent } from "@/composables/components";\n' +
    'import { loadVideoStreams, withVideoStreams, persistVideoStreams } from "@/composables/videoStreams";', f);
  s = once(s,
    '  pages.value = currentActivity.value?.options?.user_interface?.pages || [];',
    '  pages.value = withVideoStreams(\n' +
    '    currentActivity.value?.options?.user_interface?.pages || [], props.activity.entity_id,\n' +
    '  );', f);
  s = once(s,
    '    const newValue = await storage.updateUiPage(\n      props.activity.entity_id,\n      pages.value[pageIndex],\n    );',
    '    const corePage = await persistVideoStreams(pages.value[pageIndex], props.activity.entity_id);\n' +
    '    const newValue = await storage.updateUiPage(\n      props.activity.entity_id,\n      corePage,\n    );', f);
  s = once(s,
    '    setActivity(props.activity as Activity);\n  } catch (e) {\n    addErrorBottom(e);\n  }\n  loading.value = false;\n});',
    '    setActivity(props.activity as Activity);\n' +
    '    try {\n' +
    '      await loadVideoStreams();\n' +
    '      setActivity(props.activity as Activity);\n' +
    '    } catch (videoError) {\n' +
    '      console.warn("Video Stream metadata unavailable", videoError);\n' +
    '    }\n' +
    '  } catch (e) {\n    addErrorBottom(e);\n  }\n  loading.value = false;\n});', f);
  return s;
});

edit('src/composables/remote/editorCrud.ts', (s, f) => {
  // Preserve Video Stream metadata through the stock grid-editor CRUD pipeline.
  s = once(s,
    '      ...(newValues.select && { select: newValues.select }),',
    '      ...(newValues.select && { select: newValues.select }),\n' +
    '      ...(newValues.type === "video_stream" && newValues.video_stream && {\n' +
    '        video_stream: newValues.video_stream,\n' +
    '        text: newValues.video_stream.name || "Video Stream",\n' +
    '      }),', f);
  s = once(s,
    '      newValues.type !== "sensor" &&\n      newValues.type !== "select"',
    '      newValues.type !== "sensor" &&\n      newValues.type !== "select" &&\n' +
    '      newValues.type !== "video_stream"', f);
  s = once(s,
    '    } else if (\n      newValues.type === "media_player" &&',
    '    } else if (\n      newValues.type === "video_stream" &&\n' +
    '      !!(newValues.video_stream?.id || newValues.video_stream?.url)\n' +
    '    ) {\n      saveableItem.value = true;\n' +
    '    } else if (\n      newValues.type === "media_player" &&', f);
  return s;
});

console.log('Native Video Stream registered in AddWidget, GridItemEdit, ActivityRemote and native grid component');
