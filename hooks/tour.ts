import type { Span, Step, Tour } from '../types'

const TAB = '    '

export type Reader = {
  isReadable: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string | undefined>
}

export type Built = { tour: Tour } | { problems: string[] }

export function parseSpans(value: unknown): Span[] | undefined {
  const text = typeof value === 'number' ? String(value) : value

  if (typeof text !== 'string' || text.trim() === '') {
    return undefined
  }
  const spans: Span[] = []

  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/)

    if (match === null) {
      return undefined
    }
    const first = Number(match[1])
    const last = Number(match[2] ?? match[1])

    if (first < 1 || last < first) {
      return undefined
    }
    spans.push({ first, last })
  }

  return spans
}

export function spanText({ first, last }: Span): string {
  return first === last ? String(first) : `${first}-${last}`
}

export function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []

  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return (isAbsolute ? '/' : '') + parts.join('/')
}

export function resolve(root: string, file: string): string {
  return normalize(file.startsWith('/') ? file : `${root}/${file}`)
}

export function relative(root: string, path: string): string {
  const base = normalize(root)

  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/)

  if (lines.length > 1 && lines.at(-1) === '') {
    lines.pop()
  }

  return lines.map(line => line.replaceAll('\t', TAB))
}

type Loaded = { lines: string[] } | { problem: string }

async function load(path: string, shown: string, reader: Reader): Promise<Loaded> {
  if (!(await reader.isReadable(path))) {
    return { problem: `reading ${shown} is denied` }
  }
  const text = await reader.read(path)

  return text === undefined ? { problem: `${shown} was not found` } : { lines: linesOf(text) }
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

async function buildStep(
  input: unknown,
  label: string,
  root: string,
  reader: Reader,
  files: Map<string, Loaded>,
): Promise<Step | string> {
  if (typeof input !== 'object' || input === null) {
    return `${label} is not an object`
  }
  const fields = input as Record<string, unknown>
  const title = textField(fields.title)
  const file = textField(fields.file)
  const note = textField(fields.note)
  const windows = parseSpans(fields.lines)

  if (title === undefined) {
    return `${label}: title is missing`
  }
  if (file === undefined) {
    return `${label}: file is missing`
  }
  if (note === undefined) {
    return `${label}: note is missing`
  }
  if (windows === undefined || windows.length !== 1) {
    return `${label}: lines must be one range such as "30-52", not ${JSON.stringify(fields.lines)}`
  }
  const window = windows[0] as Span
  const highlight =
    fields.highlight === undefined ? [window] : parseSpans(fields.highlight)

  if (highlight === undefined) {
    return `${label}: highlight must be ranges such as "34-36, 41", not ${JSON.stringify(fields.highlight)}`
  }
  const outside = highlight.find(span => span.first < window.first || span.last > window.last)

  if (outside !== undefined) {
    return `${label}: highlight ${spanText(outside)} lies outside lines ${spanText(window)}`
  }
  const path = resolve(root, file)
  const shown = relative(root, path)
  const loaded = files.get(path) ?? (await load(path, shown, reader))

  files.set(path, loaded)
  if ('problem' in loaded) {
    return `${label}: ${loaded.problem}`
  }
  const { lines } = loaded
  if (window.last > lines.length) {
    return `${label}: ${shown} has ${lines.length} lines, so lines ${spanText(window)} run past its end`
  }

  return {
    title,
    path: shown,
    window,
    highlight,
    lines: lines.slice(window.first - 1, window.last),
    note,
  }
}

export async function buildTour(
  id: string,
  input: Record<string, unknown>,
  root: string,
  reader: Reader,
): Promise<Built> {
  const problems: string[] = []
  const title = textField(input.title)

  if (title === undefined) {
    problems.push('title is missing')
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    problems.push('steps must be a list of at least one step')

    return { problems }
  }
  const files = new Map<string, Loaded>()
  const steps: Step[] = []

  for (const [index, step] of input.steps.entries()) {
    const built = await buildStep(step, `step ${index + 1}`, root, reader, files)

    if (typeof built === 'string') {
      problems.push(built)
    } else {
      steps.push(built)
    }
  }

  return problems.length > 0 || title === undefined
    ? { problems }
    : { tour: { id, title, steps } }
}
