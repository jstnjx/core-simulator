# Native Video Stream widget for Core Simulator

The integrated Configurator at **http://localhost:8081/configurator/** is built
from Unfolded Circle's published GPL-3.0 Vue Web Configurator 2.3.3 source,
rather than injecting an independent RTSP editor or cloning rendered DOM.

The build applies a small, auditable source patch to the existing:
- `src/composables/components.ts` widget pool and component renderer
- `src/components/elements/widget/AddWidget.vue` native widget picker
- `src/components/ui/GridItemEdit.vue` native widget edit popup
- `src/components/activity/ActivityRemote.vue` native activity grid and save flow
- `src/types/activity.ts` widget type declarations

**Video Stream** now follows the other native widgets: it appears as a regular
card in the Add Widget modal; selecting it opens the existing GridItemEdit popup;
after saving it appears as a regular draggable, resizable grid item, with
the usual edit, copy/delete and selection controls. Its grid preview is a
**static placeholder**, using the native Media Player's layout, CSS classes,
and responsive compact behavior, with a camera icon and the configured stream
name. No RTSP/MJPEG connections are opened by the Configurator's grid; actual
video playback continues in the modified Qt Remote UI simulator. The editor
keeps its native buttons and inputs. There is no custom Shadow DOM sidebar,
standalone editor or injected DOM widget picker in production.

## How to run

From `core-simulator/docker`:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build rtsp-widget rtsp-configurator
```

Open **http://localhost:8081/configurator/**, log in with the Core Simulator's
existing Web Configurator credentials, open your activity's **User interface**,
then **Add → Video Stream**. Enter the name and RTSP URL and save. Existing
streams are loaded into the same activity page grid as the normal controls.

The first build downloads the source archive from:
`https://files.unfolded.tools/web-configurator-2.3.3.tar.gz`.
The source must contain `package-lock.json`, `vite.config.mts` and
`src/components/elements/widget/AddWidget.vue`. You can override the
build-time URL with the `WEB_CONFIGURATOR_SOURCE_URL` build argument.

**Version compatibility:** Core Simulator 0.74.1 bundles Web Configurator
2.1.0, while this patched frontend is built from 2.3.3. The source shares
the widget architecture, but Core API compatibility must still be tested.
If the 2.3.3 source changes the patch anchors, Docker build fails explicitly,
rather than silently falling back to a visually different editor.

## Core API compatibility

The stock Core backend **does not support a persisted
`video_stream` page-item type**. The native Vue page model merges stream
items into the editor for normal grid behavior, but the save adapter sends
only Core-supported widget types in `updateUiPage`; stream metadata is
persisted via the authenticated RTSP sidecar API, keyed by the Core activity
and page identifiers. Existing stream records remain in the
`rtsp-widget-data` Docker volume; no migration is required. The modified
desktop Qt Remote UI continues to render the same records using persistent
MJPEG.

Changing or deleting a Video Stream item in the editor updates the RTSP
sidecar. If the sidecar is unavailable, the save adapter reports an error
instead of sending an invalid widget payload to Core.

The original, unmodified 2.1.0 Web Configurator remains available on
**http://localhost:8080/configurator**. You can stop the proxy to revert,
without touching camera configurations:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml stop rtsp-configurator
```

## Licensing

The original frontend is GPL-3.0-only. The native Video Stream component,
patch script, and sidecar editor integration in this repository are also
GPL-3.0-only; the upstream license and notices remain packaged in its
compiled assets. The browser accesses only the logged-in, same-origin RTSP
proxy; camera credentials are never returned from the metadata API.

## Verification

```sh
cd docker/rtsp-configurator
npm test
```

The build runs the native Vue/Vite compiler. The actual download and
compiled app have not been tested in this environment because the supplied
archive host is unavailable from here. Check Docker build output and smoke
test add/edit/drag/delete with a running Core Simulator before production use.
