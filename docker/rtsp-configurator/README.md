# RTSP widgets inside the stock Core Simulator Web Configurator

This optional **local reverse proxy** adds an RTSP camera widget editor to the existing, prebuilt Unfolded Circle Web Configurator. It neither changes nor redistributes the stock proprietary frontend or the prebuilt Core executable.

## What it does

The original Web Configurator continues to run on `http://localhost:8080/configurator` and is proxied, unchanged, through `http://localhost:8081/configurator`. Only the HTML entry point receives two additional same-origin JS/CSS asset references. Inside the real Web Configurator, there is a **RTSP Cameras** control in the bottom-right corner and an additional **+ RTSP Camera** action beside a *Widgets* heading when that heading exists in the activity UI editor. The latter is best-effort and depends on stock frontend layout.

The integrated overlay adds:

- Core-backed activity and activity-page selection.
- Camera URL entry, frame-rate, width, enable state, and grid coordinates/sizes.
- Click-to-position activity-grid preview and live MJPEG preview.
- Existing camera management (edit, disable, delete), preserving saved RTSP camera URLs.
- Immediate compatibility with the modified `jstnjx/remote-ui` simulator's native MJPEG player.

The sidecar continues to own `widgets.json` and FFmpeg sessions. Existing saved camera widgets are reused without migration or database resets. **RTSP widgets remain sidecar metadata**, not a new item type in Core's official activity UI schema; the stock Configurator cannot serialize this custom type or show video inside its built-in grid preview. The integrated extension provides a separate grid overlay preview within the Configurator, and the modified Qt simulator renders it in the real activity page.

## Run

From the `core-simulator/docker` directory, with your existing `RTSP_WIDGET_PASSWORD` and `RTSP_WIDGET_VIEW_TOKEN` configured in `.env`:

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml up -d --build
```

Open **http://localhost:8081/configurator**, sign in using your normal Web Configurator PIN, then use **RTSP Cameras** in the same browser page. From the activity UI editor, look for **+ RTSP Camera** near the stock *Widgets* section. If the installed frontend version does not expose that heading, use the persistent RTSP Cameras entry instead.

The previous standalone editor at `http://localhost:8091/` redirects to the integrated Configurator while this Compose overlay is in use. Port `8080` remains unmodified, providing a safe fallback if the extension or proxy fails. All other `/api`, `/ws`, authentication, static resources and normal Configurator functions pass through the proxy. Do not run the standalone editor to edit streams after switching to this overlay.

### Security

The frontend uses the existing Core session cookie. Each editing request passes through the proxy, which verifies the visitor's session against Core before authenticating to the RTSP sidecar. The secret `RTSP_WIDGET_PASSWORD` stays in the proxy container and is not exposed to the browser. Cross-origin writes, missing editor CSRF headers, and access to arbitrary RTSP sidecar paths are rejected. Live MJPEG previews use this same authenticated, same-origin proxy.

This configuration is intended for a **trusted local development Mac** and binds the integrated frontend to `127.0.0.1:8081`. Do not expose it on a public network without TLS, network access controls, and an appropriate threat review. Note that Core and the RTSP sidecar retain their original published ports.

### Uninstall/revert

```sh
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml -f docker-compose-configurator-rtsp.yml stop rtsp-configurator
docker compose -f docker-compose.yml -f docker-compose-rtsp.yml up -d --force-recreate rtsp-widget
```

The original Web Configurator remains at `http://localhost:8080/configurator`. There are no data migrations; the `rtsp-widget-data` volume remains intact.

## Test

The bridge uses Node.js 22, with no external npm runtime dependencies:

```sh
cd docker/rtsp-configurator
npm test
```
