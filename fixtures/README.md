# Fixture corpus

The parser is written against this corpus, not against imagination. Nothing here is
hand-typed: `github/` holds diffs downloaded from the GitHub API in the exact media type
hunk consumes at runtime (`application/vnd.github.diff`), and `edge/` holds output produced
by real `git diff` in a throwaway repository.

Both directories carry a `CHECKSUMS` file, and `.gitattributes` marks `fixtures/**` as
`-text -diff` so git never normalizes a line ending inside them. That matters: `crlf.diff`
stops being a CRLF fixture the moment something rewrites it.

## `github/` — real history

Re-download with `./github/fetch.sh` (needs an authenticated `gh`). `MANIFEST.tsv` records
the origin of every file.

| File | Origin | What it covers |
| --- | --- | --- |
| `vite-pr-23346-normal.diff` | vitejs/vite#23346 | The ordinary case: a fix and its test, 2 files |
| `vite-pr-23378-new-files.diff` | vitejs/vite#23378 | 10 files, several of them added |
| `prettier-bb52ae36-rename.diff` | prettier/prettier | Rename at 100% similarity, added files, `@@ -1 +1,9 @@` |
| `github-docs-90ce4889-binary-add.diff` | github/docs | Added binary next to a text change |
| `github-docs-5dc99214-binary-delete.diff` | github/docs | Deleted binary: a file entry with no hunks at all |
| `git-86cfd61e-submodule-add.diff` | git/git | Submodule added — mode 160000, plus `.gitmodules` |
| `git-4125f782-submodule-bump.diff` | git/git | Submodule pointer moved, `Subproject commit` lines |
| `npm-cli-47fc8b19-mass-rename.diff` | npm/cli | 168 files, mass renames, dependency churn |
| `npm-cli-75a943de-minified-bundle.diff` | npm/cli | 380 KB in **174 lines** — minified bundles |
| `linux-93e4b307-huge.diff` | torvalds/linux | 758 files, 2.1 MB |

The last two are the ones that matter for the benchmark. `npm-cli-75a943de` is the wrapping
adversary: a handful of lines, each tens of kilobytes wide. `linux-93e4b307` is the volume
adversary.

## `edge/` — generated, still real

Regenerate with `./edge/generate.sh`. It builds a scratch repository, drives real git, and
emits real `git diff` output; blob hashes come from content alone, so two runs produce
identical bytes.

These cases exist because they could not be found. Scanning hundreds of commits across
git/git, torvalds/linux, npm/cli, vitejs/vite, prettier, babel, TypeScript, esbuild and
vscode turned up zero occurrences of `\ No newline at end of file` and zero mode changes.
Rare in the corpus, still fatal to a parser.

| File | What it covers |
| --- | --- |
| `no-newline-added.diff` | `\ No newline at end of file` after the added line |
| `no-newline-removed.diff` | The marker after the removed line |
| `no-newline-both.diff` | The marker twice, on both sides of one hunk |
| `mode-change-only.diff` | `old mode` / `new mode` and **nothing else** — no index, no `---`, no hunks |
| `mode-change-with-content.diff` | Mode change plus edits; note the `index` line drops its mode suffix |
| `empty.diff` | Zero bytes |
| `empty-file-add.diff` | A 0-byte file added: header with no hunks |
| `empty-file-delete.diff` | A 0-byte file deleted |
| `crlf.diff` | CRLF inside the diff payload |
| `unicode.diff` | Combining marks, CJK, RTL, and a ZWJ emoji sequence |
| `single-line-hunk-header.diff` | `@@ -1 +1 @@` — the count omitted |
| `many-hunks.diff` | Three hunks in one file |
| `path-with-spaces.diff` | A path with a space, which git terminates with a **tab** on the `---`/`+++` lines |
| `path-quoted-utf8.diff` | A non-ASCII path: git wraps it in quotes and escapes every byte in octal |

The last two are the traps worth naming. `diff --git a/spaced name.txt b/spaced name.txt`
cannot be split on whitespace, and the trailing tab on the `---` line is significant. And a
non-ASCII path does not arrive as text at all — git writes
`"a/cafÃ© â.txt"`, quoted, with every non-ASCII byte escaped in octal, so
the path has to be unescaped back into bytes and decoded before anything can display it.
