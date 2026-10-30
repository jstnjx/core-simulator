# RTSP widget streaming backend for Core Simulator

This service stores activity-scoped RTSP camera settings, provides HLS and MJPEG streams, and exposes an API used by the modified native Qt Remote UI simulator. When the integrated Configurator is enabled, the previous standalone editor redirects to the Web Configurator.

## Quick start

Run from the docker directory:

    export RTSP_WIDGET_PASSWORD='replace-with-a-long-unique-password'
    docker compose -f docker-compose.yml -f docker-compose-rtsp.yml up -d --build

Open http://localhost:8091/ and authenticate as **admin** with your RTSP_WIDGET_PASSWORD.

Add an RTSP URI (for example rtsp://camera-user:camera-pass@192.168.1.20:554/live), select an activity and then its page from the Core-powered dropdowns, choose grid position and size, and save. The selected activity page automatically supplies its grid dimensions. Refresh activities to reload the list, or use **Enter IDs manually** when Core is unavailable. Each card displays the stream and links to an embeddable player and a 480×850 activity-grid preview, with every configured feed rendered at its assigned cell position.

## Endpoints

| Method / Path | Behavior |
| --- | --- |
| GET /api/core/activities | List Core activities (names and IDs) for the picker |
| GET /api/core/activities/{id}/pages | List activity UI pages including grid dimensions for the picker |
| GET /api/widgets | List widgets, source hosts, statuses and placements; camera secrets are redacted |
| POST /api/widgets | Create widget from JSON |
| GET /api/widgets/{id} | Get a single widget and status |
| PUT /api/widgets/{id} | Update; omit url to preserve the existing camera URL |
| DELETE /api/widgets/{id} | Delete and stop shared HLS session |
| POST /api/widgets/{id}/restart | Restart shared HLS session |
| POST /api/widgets/{id}/stop | Stop shared HLS session |
| GET /api/activities/{activityId}/pages/{pageId}/widgets | List sidecar widgets assigned to an activity page |
| GET /embed/{id} | Embeddable HLS/MJPEG browser player |
| GET /view/{activityId}/{pageId} | Simulator activity-grid playback preview with positioned video tiles |
| GET /hls/{id}/index.m3u8 | H.264 HLS live playlist, generated on demand |
| GET /snapshot/{id}.jpg | Latest JPEG frame (shared FFmpeg decoder, Qt fallback) |
| GET /mjpeg/{id} | Low latency JPEG multipart stream |
| GET /health | Unauthenticated health probe |

Except for /health, all endpoints require HTTP Basic authentication using user admin.

Widget settings persist in the rtsp-widget-data Docker volume; credentials are omitted from API responses and client HTML.

## Playback characteristics

- FFmpeg ingests RTSP / RTSPS over TCP and transcodes to browser-compatible H.264 HLS. The browser uses locally bundled hls.js.
- An MJPEG mode is included for lower latency, with a maximum of four concurrent viewers.
- HLS decoding sessions are shared per widget, started on demand, and automatically stopped after 90 seconds without requests.
- Automatic source restart occurs on subsequent playlist requests if FFmpeg exits; stop/restart actions are available.
- Stream resolution and frame rate are configurable, defaulting to 640 px and 24 fps for new widgets. Saved widgets keep their existing FPS setting until edited. HLS uses one-second segments; actual latency depends on the decoder and player.
- Web browser playback requires that the service be reachable on the viewer's network.

## Core API / Remote UI integration limitations

The Core Simulator repository contains Docker orchestration, sample data, and a **prebuilt Core container image**. The official Core API does not accept an rtsp_stream or video activity UI item type. **This sidecar's widget data is independent of the stock Core API**, although its activity/page/grid metadata can be read by custom clients.

The stock Web Configurator and physical Remote UI therefore do **not** automatically display these widgets. First-class native activity-video rendering requires changes to Core's schema and its executable, plus a custom Remote UI Qt renderer and device-level codec verification.

## Security and troubleshooting

Use HTTPS when accessing this through a public reverse proxy, and restrict access to trusted users. Browsers block embedding an HTTP stream inside an HTTPS page. Camera URLs can be exposed to local process-list viewers (FFmpeg command arguments), so do not grant untrusted shell or Docker access. The service refuses to start unless RTSP_WIDGET_PASSWORD is at least 12 characters.

Run API tests from docker/rtsp-widget using npm test (a live camera is not required). For stream issues, inspect docker compose logs -f rtsp-widget and test the RTSP URL in another player.

## Core activity picker

`docker-compose-rtsp.yml` connects the sidecar to `http://core-simulator:8080` using the simulator's Web Configurator account. It defaults to the simulator's standard `web-configurator` / `1234` credentials; if you changed the PIN, set `CORE_API_PASSWORD=your-new-pin` in `docker/.env`. `CORE_API_USERNAME` and `CORE_API_URL` may be overridden if required. All requests go through the authenticated sidecar; browser responses do not contain Core credentials. Core must be running and reachable for automatic discovery. The manual ID option still works without Core.

## Native Qt Remote UI simulator

To display saved camera widgets **inside the actual Remote UI activity screen**, use the matching changes
in [jstnjx/remote-ui](https://github.com/jstnjx/remote-ui). Set a separate read-only token
in `docker/.env`:

```dotenv
RTSP_WIDGET_VIEW_TOKEN=replace-with-a-random-token-at-least-16-characters
```

Restart `rtsp-widget`. Configure the Remote UI simulator with
`UC_RTSP_WIDGET_URL=http://127.0.0.1:8091` and
`UC_RTSP_WIDGET_TOKEN=<same-read-only-token>` when launching the desktop app.
The activity screen discovers widgets using the existing Core activity and page IDs.

This token permits **only** reading scoped activity widget metadata and fetching HLS, MJPEG,
or JPEG snapshot frames. It cannot modify widgets, read the administrator interface, or retrieve camera RTSP credentials.
Keep it private and use HTTPS if accessing the service over a network rather than localhost.
The HLS playlist URL is rewritten to include the read-only token in segment URLs for native Qt
player compatibility. For Qt builds without a usable HLS backend, the native QML widget automatically
falls back to an image sequence, using up to 12 JPEG updates per second and an FFmpeg source capped at 15 FPS. The first snapshot request waits briefly for the decoder to start rather than immediately returning HTTP 503.


## Integrated Web Configurator editor (preferred)

The RTSP editor is now available **inside the stock Core Simulator Web Configurator**
through the optional same-origin proxy extension. See
[rtsp-configurator/README.md](../rtsp-configurator/README.md).

Run the three Compose files:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build
```

Open **http://localhost:8081/configurator** and sign in with your usual Core PIN.
Use the integrated **RTSP Cameras** control; there is no need to use port 8091
for stream editing. Existing widgets persist in the same Docker volume.

The stock configurator's built-in widget schema is not modified. The injected
editor writes RTSP sidecar placements keyed to real Core activity/page IDs; the
custom Qt simulator displays them as an overlay on its native activity pages.
