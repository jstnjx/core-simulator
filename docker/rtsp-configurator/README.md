# Video Stream widget in the Core Simulator activity UI editor

This extension adds a **Video Stream** option **inside the same Add Widget picker as the stock Media Player, Button, and Select types**. The option is cloned from the actual bundled Media Player widget card, reusing its original CSS classes, typography, dimensions, color states, spacing and hover styling. Its label and icon are replaced without reimplementing the complete stock theme. Click or drag it to open the inline Video Stream inspector and place a live camera on the activity grid. The old standalone RTSP modal and the custom, permanently visible widget card are hidden.

The picker option appears once the activity editor's **Add** widget palette is open and contains Media Player plus at least one Button or Select type. The extension observes Vue's dynamic DOM and re-adds the native-looking entry whenever the stock picker is recreated. This approach retains the first-party appearance of the current installed Configurator version instead of hardcoding a separate style.

The inspector is shown only when editing a Video Stream. It inherits the native picker colors, border radius, and borders where available. Saved Video Stream tiles have a live preview on the activity grid and can be clicked, repositioned, resized, edited, or deleted.

## Start

From `core-simulator/docker`, with `RTSP_WIDGET_PASSWORD` and `RTSP_WIDGET_VIEW_TOKEN` set in `.env`:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build
```

Open **http://localhost:8081/configurator** and sign in with the usual Web Configurator PIN. Open an activity, choose **Edit user interface**, click **Add**, and expand the stock widget picker if necessary. **Video Stream** should appear directly beside **Media Player**, with the same first-party tile styling. It will not appear on the normal Configurator overview or as a floating RTSP menu.

Choose the activity page, click or drag Video Stream, enter a name and RTSP URL, configure X/Y, width/height, output width and FPS, and click **Save Video Stream**. Existing streams can be selected through the sidebar list or by clicking their overlay tiles on the activity grid. Drag an existing tile to reposition it and save. Native desktop `remote-ui` receives updates from the same RTSP service and renders the feed.

The extension attempts to track the selected Core activity and UI page automatically from routes and active page tabs. The activity and page selectors in the widget's inline inspector are a fallback for frontend versions that do not expose selection in the DOM.

### Architecture and scope

The prebuilt Core's activity-item schema **does not support a Video Stream type**. For compatibility, stream settings are stored in the existing `rtsp-widget-data` Docker volume and keyed by the real Core activity ID, UI page ID and grid position. The page editor shows Video Stream placements via an overlay on the stock grid; the underlying Core page JSON remains unchanged. The modified desktop Remote UI renders the same saved placements as live MJPEG streams. **This is not a firmware-level widget on physical Remote 3 hardware.**

The extension finds the activity editor's **Add** control to mount the settings inspector, but only inserts the **Video Stream** entry when it identifies the real native widget picker containing **Media Player** plus **Button** or **Select**. It does not add a separate custom widget button beside Grid/Reset anymore. The picker entry is copied from the native Media Player tile, preventing a competing visual design.

If the control is missing, first verify that the browser is using **http://localhost:8081/configurator** (not port 8080), then run `docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build --force-recreate rtsp-configurator`. In the browser developer console, `document.documentElement.dataset.ucVideoStreamAddon` must equal `"loaded"`. The console prints `[Video Stream] Native widget tile inserted alongside Media Player` when the new item is inserted into the native picker. If it does not appear, make sure **Add → Widgets** is open. A missing `loaded` flag means the proxy did not inject or run the script, whereas a loaded flag without an insertion message means the editor's current DOM needs a new selector.

The integration relies on the DOM of the installed stock Web Configurator, which is not part of this repository. Detection of its Widgets palette and grid is best-effort across frontend versions; it has not yet been visually validated against your live 0.74.1-bt image. If the widget does not appear or the grid overlay is misaligned, the next step is to inspect the current editor's DOM and adjust the integration selectors.

The stock Configurator at **http://localhost:8080/configurator** is completely unchanged. The reverse proxy on port 8081 injects a same-origin script into the Configurator HTML, serves stylesheet assets, forwards normal Core REST/WebSocket traffic, and protects RTSP writes using the existing Core login session. The RTSP admin password stays in the proxy container and never reaches the browser.

The legacy sidecar on port 8091 still handles stream ingest/playback, and its root route redirects to the integrated Configurator when this Compose overlay is enabled. **Do not remove the sidecar:** only the separate editor is replaced.

### Security

For a trusted local developer machine, the proxy binds to `127.0.0.1:8081`. The sidecar management API is available only through a session-checked same-origin proxy route. Cross-origin writes and unsupported paths are blocked. Camera stream credentials are kept server-side and omitted from editor API responses. Do not expose ports publicly without TLS and access controls.

### Tests

```sh
cd docker/rtsp-configurator
npm test
```

The tests cover HTML injection, static asset delivery, Core API passthrough, authentication, write restrictions, native picker recognition and source checks. Actual pixel-level appearance, Vue event propagation and placement still require a browser smoke test with the installed Core 0.74.1-bt bundle.

### Revert

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml stop rtsp-configurator
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml up -d --force-recreate rtsp-widget
```

Existing Video Stream records remain intact in `rtsp-widget-data`.
