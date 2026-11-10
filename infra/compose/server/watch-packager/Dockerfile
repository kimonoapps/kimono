# Kimono Watch's HLS packager: a small Go front end on jellyfin-ffmpeg, taken
# from Jellyfin's image so the GPU drivers it needs (Intel media, Mesa VAAPI)
# come with it. Build from the repository root:
#   docker build -f infra/compose/server/watch-packager/Dockerfile .
ARG JELLYFIN_TAG=latest

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY infra/compose/server/watch-packager infra/compose/server/watch-packager
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kimono-watch-packager ./infra/compose/server/watch-packager

FROM docker.io/jellyfin/jellyfin:${JELLYFIN_TAG}
LABEL org.opencontainers.image.source=https://github.com/kimonoapps/kimono
COPY --from=build /out/kimono-watch-packager /usr/local/bin/kimono-watch-packager
ENV KIMONO_PACKAGER_WORK=/var/cache/kimono-packager
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/kimono-watch-packager"]
