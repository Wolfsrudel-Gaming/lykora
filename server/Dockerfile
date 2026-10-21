# Baut den Lykora-Server mit Web-Dashboard und Klangbibliothek. Build-Kontext ist die Wurzel des Repos:
#   docker build -f server/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY spec/package.json spec/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root
COPY spec spec
COPY server server
COPY web web
RUN npm run build -w @lykora/server \
 && npm run build -w @lykora/web \
 && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    MEDIA_LIBRARY_DIR=/app/server/media-library
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/spec spec
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/server/media-library server/media-library
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/server
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.BASE_PATH??'/lykora')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
