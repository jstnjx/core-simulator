# Build the GPL-3 Web Configurator from published Vue source, with native
# Video Stream components compiled into the widget pool and editor.
FROM node:24-bookworm-slim AS configurator-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar git  && rm -rf /var/lib/apt/lists/*
ARG WEB_CONFIGURATOR_SOURCE_URL=https://files.unfolded.tools/web-configurator-2.3.3.tar.gz
WORKDIR /build
RUN mkdir -p /tmp/upstream  && curl --fail --location --retry 3 --retry-delay 2 "$WEB_CONFIGURATOR_SOURCE_URL" -o /tmp/source.tar.gz  && tar -xzf /tmp/source.tar.gz -C /tmp/upstream  && entry="$(find /tmp/upstream -path '*/src/components/elements/widget/AddWidget.vue' -type f -print -quit)"  && test -n "$entry"  && src="${entry%/src/components/elements/widget/AddWidget.vue}"  && cp -a "$src"/. /build/  && test -f package-lock.json  && test -f vite.config.mts
COPY native/ /patch/
RUN test -s version.txt || printf 'v2.3.3-video-stream\n' > version.txt
RUN node /patch/patch-web-configurator.mjs /build  && npm ci --no-audit --no-fund  && npm run type-check  && BASE_URL=/configurator/ npm run build-only  && test -s dist/index.html

FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY --from=configurator-build /build/dist ./native-dist/
USER node
EXPOSE 8081
CMD ["node", "server.js"]
