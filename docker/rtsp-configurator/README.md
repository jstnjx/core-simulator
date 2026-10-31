# Video Stream widget in the Core Simulator activity UI editor

This optional extension inserts a **Video Stream** widget into the **Widgets** section of the **stock activity UI editor**. Click it to configure a camera in an inline widget inspector, or drag it onto the activity grid to select the initial position. Existing Video Stream tiles are shown on the grid overlay and in the sidebar, where they can be selected, repositioned, resized, saved or deleted.

The original Web Configurator is a prebuilt application in the Core Simulator Docker image, so the extension uses a reversible same-origin proxy. The stock Configurator and its existing widget types remain intact. There is **no standalone RTSP editor and no floating RTSP Cameras dialog** in this flow.

## Start

From `core-simulator/docker`, with `RTSP_WIDGET_PASSWORD` and `RTSP_WIDGET_VIEW_TOKEN` set in `.env`:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build
```

Open **http://localhost:8081/configurator** and sign in with the usual Web Configurator PIN. Open an activity, choose **Edit user interface**, and look for **Video Stream** in the existing **Widgets** section alongside other widget types.

Choose the activity page, click or drag Video Stream, enter a name and RTSP URL, configure X/Y, width/height, output width and FPS, and click **Save Video Stream**. Existing streams can be selected through the sidebar list or by clicking their overlay tiles on the activity grid. Drag an existing tile to reposition it and save. Native desktop `remote-ui` receives updates from the same RTSP service and renders the feed.

The extension attempts to track the selected Core activity and UI page automatically from routes and active page tabs. The activity and page selectors in the widget's inline inspector are a fallback for frontend versions that do not expose selection in the DOM.

### Architecture and scope

The prebuilt Core's activity-item schema **does not support a Video Stream type**. For compatibility, stream settings are stored in the existing `rtsp-widget-data` Docker volume and keyed by the real Core activity ID, UI page ID and grid position. The page editor shows Video Stream placements via an overlay on the stock grid; the underlying Core page JSON remains unchanged. The modified desktop Remote UI renders the same saved placements as live MJPEG streams. **This is not a firmware-level widget on physical Remote 3 hardware.**

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

The tests cover HTML injection, static asset delivery, Core API passthrough, authentication, write restrictions, and the Video Stream editor source. Runtime placement in the stock bundled frontend still requires a browser smoke test.

### Revert

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml stop rtsp-configurator
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml up -d --force-recreate rtsp-widget
```

Existing Video Stream records remain intact in `rtsp-widget-data`.
