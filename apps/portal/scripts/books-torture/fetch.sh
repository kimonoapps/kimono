#!/bin/sh
# Download the public-domain Project Gutenberg texts used by the long, columns, notes and scanned cases.
set -e
cd "$(dirname "$0")"
mkdir -p cache
for id in 2701 575 11 1022; do
  [ -s cache/pg$id.txt ] || curl -fsSL -o cache/pg$id.txt "https://www.gutenberg.org/cache/epub/$id/pg$id.txt"
done
