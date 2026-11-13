# Kimono Books' indexer. Build from the repository root:
#   docker build -f infra/compose/server/books-indexer/Dockerfile .
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY infra/compose/server/books-indexer infra/compose/server/books-indexer
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kimono-books-indexer ./infra/compose/server/books-indexer

FROM docker.io/library/alpine:3.22
LABEL org.opencontainers.image.source=https://github.com/kimonoapps/kimono
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/kimono-books-indexer /usr/local/bin/kimono-books-indexer
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/kimono-books-indexer"]
