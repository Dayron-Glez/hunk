#!/usr/bin/env bash
# Re-downloads the corpus in this directory from the GitHub API, in the exact
# media type hunk consumes at runtime (application/vnd.github.diff).
set -euo pipefail
cd "$(dirname "$0")"

fetch() { gh api -H "Accept: application/vnd.github.diff" "$2" > "$1"; }

fetch vite-pr-23346-normal.diff            repos/vitejs/vite/pulls/23346
fetch vite-pr-23378-new-files.diff         repos/vitejs/vite/pulls/23378
fetch prettier-bb52ae36-rename.diff        repos/prettier/prettier/commits/bb52ae36d5
fetch github-docs-90ce4889-binary-add.diff repos/github/docs/commits/90ce4889da
fetch github-docs-5dc99214-binary-delete.diff repos/github/docs/commits/5dc992146e
fetch git-86cfd61e-submodule-add.diff      repos/git/git/commits/86cfd61e6b
fetch git-4125f782-submodule-bump.diff     repos/git/git/commits/4125f78222
fetch npm-cli-47fc8b19-mass-rename.diff    repos/npm/cli/commits/47fc8b191a
fetch npm-cli-75a943de-minified-bundle.diff repos/npm/cli/commits/75a943ded9
fetch linux-93e4b307-huge.diff             repos/torvalds/linux/commits/93e4b3076b

sha256sum -c CHECKSUMS
