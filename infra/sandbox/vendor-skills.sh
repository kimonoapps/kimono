#!/bin/sh
# Copies the skills Kimono AI offers into infra/sandbox/skills, from the
# commits pinned below, with each one's licence beside it. The sandbox image
# carries them at /opt/kimono/skills; a turn links in the ones the person has
# turned on (cli/internal/sandbox/config.go, DefaultAgent). Run it again after
# changing a pin, and review what changed before committing.
#
#   <id> <repo> <commit> <path in repo> <licence file in repo>
set -eu
cd "$(dirname "$0")"
pins='
i-have-adhd       ayghri/i-have-adhd               1ecea1993b7fce257ffbd686c070948b5e07eda6 skills/i-have-adhd        LICENSE
docx              anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/docx               skills/docx/LICENSE.txt
pdf               anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/pdf                skills/pdf/LICENSE.txt
pptx              anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/pptx               skills/pptx/LICENSE.txt
xlsx              anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/xlsx               skills/xlsx/LICENSE.txt
frontend-design   anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/frontend-design    skills/frontend-design/LICENSE.txt
discernment-nudge anthropics/skills                2c5958ecac7cee2b583967a2c4981d0f4a75c579 skills/discernment-nudge  skills/discernment-nudge/LICENSE.txt
humanizer         blader/humanizer                 0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0 SKILL.md                  LICENSE
socratic-method   malkreide/socratic-method-skill  7bf0d1d73d9e9b854c13b745fc87f4b0b66bb232 SKILL.md                  LICENSE
'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rm -rf skills && mkdir skills
echo "$pins" | while read -r id repo commit path licence; do
  [ -n "$id" ] || continue
  archive="$work/$(echo "$repo" | tr / _)-$commit"
  if [ ! -d "$archive" ]; then
    mkdir -p "$archive"
    curl -fsSL "https://codeload.github.com/$repo/tar.gz/$commit" | tar -xz -C "$archive" --strip-components=1
  fi
  mkdir -p "skills/$id"
  if [ -d "$archive/$path" ]; then cp -R "$archive/$path/." "skills/$id/"; else cp "$archive/$path" "skills/$id/SKILL.md"; fi
  [ -f "skills/$id/LICENSE.txt" ] || cp "$archive/$licence" "skills/$id/LICENSE.txt"
  printf 'From https://github.com/%s at %s (%s).\n' "$repo" "$commit" "$path" > "skills/$id/SOURCE.txt"
  echo "$id: $(find "skills/$id" -type f | wc -l | tr -d ' ') files"
done
