#!/usr/bin/env bash
# Produces the edge-case corpus with real git, in a throwaway repository.
#
# These cases barely show up in public history — scanning hundreds of commits
# across git, linux, npm/cli, vite, prettier, babel, TypeScript, esbuild and
# vscode turned up not one `\ No newline at end of file` and not one mode
# change. They are still the cases that break parsers, so they are produced
# here instead of imagined. Output is byte-identical on every run: git derives
# blob hashes from content alone.
set -euo pipefail

out="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work"
cd "$work"
git config core.autocrlf false
git config core.safecrlf false
git config user.name fixture
git config user.email fixture@hunk.invalid

commit() { git add -A && git commit -q --no-verify -m "$1"; }
emit() { git diff --no-color --no-ext-diff "$1" "$2" -- > "$out/$3"; }

printf 'alpha\nbravo\ncharlie\n' > lf.txt
printf 'keep\n' > pinned.txt
commit base
base=$(git rev-parse HEAD)

printf 'alpha\nbravo\nDELTA' > lf.txt
commit no-newline-added
emit "$base" HEAD no-newline-added.diff

git checkout -q "$base"
printf 'alpha\nbravo\ncharlie' > lf.txt
commit no-newline-seed
seed=$(git rev-parse HEAD)
printf 'alpha\nbravo\ncharlie\n' > lf.txt
commit no-newline-removed
emit "$seed" HEAD no-newline-removed.diff

printf 'alpha\nbravo\nECHO' > lf.txt
commit no-newline-both
emit "$seed" HEAD no-newline-both.diff

git checkout -q "$base"
git update-index --chmod=+x lf.txt
git commit -q --no-verify -m mode-only
emit "$base" HEAD mode-change-only.diff

git checkout -q "$base"
printf 'alpha\nBRAVO\ncharlie\n' > lf.txt
git add -A
git update-index --chmod=+x lf.txt
git commit -q --no-verify -m mode-and-content
emit "$base" HEAD mode-change-with-content.diff

git checkout -q "$base"
: > blank.txt
commit empty-file-added
blank=$(git rev-parse HEAD)
emit "$base" HEAD empty-file-add.diff
rm blank.txt
commit empty-file-deleted
emit "$blank" HEAD empty-file-delete.diff

git checkout -q "$base"
git commit -q --no-verify --allow-empty -m nothing
emit "$base" HEAD empty.diff

git checkout -q "$base"
printf 'alpha\r\nbravo\r\ncharlie\r\n' > crlf.txt
commit crlf-seed
crlf=$(git rev-parse HEAD)
printf 'alpha\r\nBRAVO\r\ncharlie\r\n' > crlf.txt
commit crlf-change
emit "$crlf" HEAD crlf.diff

git checkout -q "$base"
printf 'caf\xc3\xa9 \xe2\x98\x95\n\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e\n\xd7\xa2\xd7\x91\xd7\xa8\xd7\x99\xd7\xaa\n\xf0\x9f\x91\xa9\xe2\x80\x8d\xf0\x9f\x91\xa9\xe2\x80\x8d\xf0\x9f\x91\xa7\n' > unicode.txt
commit unicode-seed
uni=$(git rev-parse HEAD)
printf 'caf\xc3\xa9 \xe2\x98\x95\n\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e!\n\xd7\xa2\xd7\x91\xd7\xa8\xd7\x99\xd7\xaa\n\xf0\x9f\x91\xa8\xe2\x80\x8d\xf0\x9f\x91\xa9\xe2\x80\x8d\xf0\x9f\x91\xa6\n' > unicode.txt
commit unicode-change
emit "$uni" HEAD unicode.diff

git checkout -q "$base"
printf 'solo\n' > single.txt
commit single-seed
single=$(git rev-parse HEAD)
printf 'unico\n' > single.txt
commit single-change
emit "$single" HEAD single-line-hunk-header.diff

git checkout -q "$base"
seq 1 60 > wide.txt
commit wide-seed
wide=$(git rev-parse HEAD)
seq 1 60 | sed -e 's/^3$/three/' -e 's/^30$/thirty/' -e 's/^58$/fifty-eight/' > wide.txt
commit wide-change
emit "$wide" HEAD many-hunks.diff

git checkout -q "$base"
printf 'a b\tc\n' > 'spaced name.txt'
commit quoted-seed
quoted=$(git rev-parse HEAD)
printf 'a b\tc d\n' > 'spaced name.txt'
commit quoted-change
emit "$quoted" HEAD path-with-spaces.diff

cd "$out"
sha256sum *.diff > CHECKSUMS
