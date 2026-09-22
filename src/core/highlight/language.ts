/**
 * Grammar to use for a path, or null to render it plain.
 *
 * Deliberately a short list. Every grammar is a separate download, and a diff
 * viewer that pulls two hundred of them to colour a lockfile has spent the
 * budget this project exists to defend. Unknown is a fine answer: uncoloured
 * text is still readable, a five-second wait is not.
 */

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  ini: 'ini',
  diff: 'diff',
  patch: 'diff',
}

const BY_FILENAME: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'make',
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
  '.gitattributes': 'ini',
  '.gitmodules': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
}

export function languageOf(path: string | null): string | null {
  if (path === null) return null

  const name = (path.split('/').pop() ?? '').toLowerCase()
  if (name === '') return null

  const byName = BY_FILENAME[name]
  if (byName !== undefined) return byName

  // A dotfile with no further dot has no extension: `.gitignore` is a name.
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null

  return BY_EXTENSION[name.slice(dot + 1)] ?? null
}

/** Every grammar this build can ask for, so the worker can validate a request. */
export const SUPPORTED_LANGUAGES: readonly string[] = [
  ...new Set([...Object.values(BY_EXTENSION), ...Object.values(BY_FILENAME)]),
].sort()
