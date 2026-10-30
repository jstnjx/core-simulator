FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg tini
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js streams.js ./
COPY public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8091
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
