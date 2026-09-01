#!/usr/bin/env bash
# Produces the edge-case corpus with real git, in a throwaway repository.
#
# These cases barely show up in public history — scanning hundreds of commits
# across git, linux, npm/cli, vite, prettier, babel, TypeScript, esbuild and
# vscode turned up not one `\ No newline at end of file` and not one mode
# change. They are still the cases that break parsers, so they are produced
# here instead of imagined.
#
# Output is byte-identical on every run: git derives blob hashes from content
# alone, and the commit dates are pinned below so tree ids stay put too.
set -euo pipefail

out="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work"
cd "$work"
git config core.autocrlf false
git config core.safecrlf false
git config core.quotePath true
git config user.name fixture
git config user.email fixture@hunk.invalid
export GIT_AUTHOR_DATE='2020-01-01T00:00:00+0000'
export GIT_COMMITTER_DATE='2020-01-01T00:00:00+0000'

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
printf 'caf\303\251 \342\230\225\n\346\227\245\346\234\254\350\252\236\n\327\242\327\221\327\250\327\231\327\252\n\360\237\221\251\342\200\215\360\237\221\251\342\200\215\360\237\221\247\n' > unicode.txt
commit unicode-seed
uni=$(git rev-parse HEAD)
printf 'caf\303\251 \342\230\225\n\346\227\245\346\234\254\350\252\236!\n\327\242\327\221\327\250\327\231\327\252\n\360\237\221\250\342\200\215\360\237\221\251\342\200\215\360\237\221\246\n' > unicode.txt
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

# Built with plumbing instead of the working tree. The point of this fixture is
# the exact bytes git writes for a path it has to quote, and a filename like this
# does not survive every filesystem intact — macOS would hand back a
# decomposed form and the bytes would no longer be the ones under test.
git checkout -q "$base"
quoted_name=$(printf 'caf\303\251 \342\230\225.txt')
before=$(printf 'seed\n' | git hash-object -w --stdin)
after=$(printf 'changed\n' | git hash-object -w --stdin)
tree_before=$(printf '100644 blob %s\t%s\n' "$before" "$quoted_name" | git mktree)
tree_after=$(printf '100644 blob %s\t%s\n' "$after" "$quoted_name" | git mktree)
emit "$tree_before" "$tree_after" path-quoted-utf8.diff

cd "$out"
sha256sum *.diff > CHECKSUMS
