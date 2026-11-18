import type { Elements, RenderElement } from 'claude-code'

import type { Span, Step, Tour } from '../types'
import { spanText } from './tour'
import { treeRows } from './tree'
import type { TreeFile } from './tree'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Code' | 'Markdown'>

export type Go = (step: number) => Promise<void>

export type Actions = { go: Go; close: () => Promise<void> }

const ACCENT = 'claude'
const WIDE = 120
const HOTKEYS = 9

type Run = { first: number; lines: string[]; isLit: boolean }

const isLit = (spans: readonly Span[], line: number) =>
  spans.some(span => line >= span.first && line <= span.last)

export function runsOf(step: Step): Run[] {
  const runs: Run[] = []

  for (const [index, text] of step.lines.entries()) {
    const line = step.window.first + index
    const lit = isLit(step.highlight, line)
    const last = runs.at(-1)

    if (last !== undefined && last.isLit === lit) {
      last.lines.push(text)
    } else {
      runs.push({ first: line, lines: [text], isLit: lit })
    }
  }

  return runs
}

export function filesOf(tour: Tour): TreeFile[] {
  const files: TreeFile[] = []

  for (const [index, step] of tour.steps.entries()) {
    const known = files.find(file => file.path === step.path)

    if (known === undefined) {
      files.push({ path: step.path, steps: [index] })
    } else if (!known.steps.includes(index)) {
      known.steps.push(index)
    }
  }

  return files
}

function drawHeader(
  kit: Kit,
  tour: Tour,
  at: number,
  isFocused: boolean,
  { go, close }: Actions,
): RenderElement {
  const { Box, Text, Button } = kit
  const isFirst = at === 0
  const isLast = at === tour.steps.length - 1

  return (
    <Box flexDirection="row" justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        <Text bold wrap="truncate-end">
          {tour.title}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0} gap={2}>
        {!isFocused && <Text dimColor>ctrl+x tab</Text>}
        <Button key="prev" plain hotkey="p" dimColor={isFirst} onPress={() => go(at - 1)}>
          prev
        </Button>
        <Button key="next" plain hotkey="n" dimColor={isLast} onPress={() => go(at + 1)}>
          next
        </Button>
        <Button key="close" plain hotkey="q" onPress={close}>
          close
        </Button>
        <Text dimColor>
          {at + 1}/{tour.steps.length}
        </Text>
      </Box>
    </Box>
  )
}

function drawJourney(kit: Kit, tour: Tour, at: number, go: Go): RenderElement {
  const { Box, Text, Button } = kit

  return (
    <Box flexDirection="row" flexWrap="wrap" rowGap={0}>
      {tour.steps.map((step, index) => {
        const hotkey = index < HOTKEYS ? { hotkey: String(index + 1) } : {}
        const label =
          index === at ? (
            <Text bold color={ACCENT}>
              {step.title}
            </Text>
          ) : (
            step.title
          )
        const parts = index < HOTKEYS ? [label] : [<Text dimColor>{`${index + 1}: `}</Text>, label]

        return (
          <Box key={`hop-${index}`} flexDirection="row" flexShrink={0}>
            {index > 0 && <Text dimColor> → </Text>}
            <Button
              key={`step-${index}`}
              plain
              {...hotkey}
              dimColor={index > at}
              onPress={() => go(index)}
            >
              {parts}
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

function drawTree(kit: Kit, tour: Tour, at: number, go: Go): RenderElement {
  const { Box, Text, Button } = kit
  const current = tour.steps[at]?.path

  return (
    <Box flexDirection="column">
      {treeRows(filesOf(tour)).map(row => {
        const file = row.file

        if (file === undefined) {
          return (
            <Text dimColor wrap="truncate-end">
              {row.guide}
              {row.name}
            </Text>
          )
        }
        const isHere = file.path === current

        return (
          <Box key={`row-${file.path}`} flexDirection="row">
            <Text dimColor>{row.guide}</Text>
            <Button
              key={`file-${file.path}`}
              plain
              dimColor={!isHere && Math.min(...file.steps) > at}
              onPress={() => go(file.steps.includes(at) ? at : (file.steps[0] ?? 0))}
            >
              {isHere ? (
                <Text bold color={ACCENT}>
                  {row.name}
                </Text>
              ) : (
                row.name
              )}
              {file.steps.map(step =>
                step === at ? (
                  <Text bold color={ACCENT}>
                    {` ${step + 1}`}
                  </Text>
                ) : (
                  <Text dimColor>{` ${step + 1}`}</Text>
                ),
              )}
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

function drawCode(kit: Kit, step: Step): RenderElement {
  const { Box, Text, Code } = kit
  const digits = String(step.window.last).length
  const number = (line: number) => String(line).padStart(digits)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{step.path}</Text>
        <Text dimColor>:{spanText(step.window)}</Text>
      </Text>
      {runsOf(step).map(run => {
        if (!run.isLit) {
          return (
            <Box key={`dim-${run.first}`} flexDirection="column">
              {run.lines.map((text, index) => (
                <Text dimColor wrap="truncate-end">
                  {`${number(run.first + index)}   ${text === '' ? ' ' : text}`}
                </Text>
              ))}
            </Box>
          )
        }
        return (
          <Box key={`lit-${run.first}`} flexDirection="row">
            <Box flexDirection="column" flexShrink={0}>
              {run.lines.map((_, index) => (
                <Text color={ACCENT}>{`${number(run.first + index)} ▌ `}</Text>
              ))}
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Code source={run.lines.join('\n')} path={step.path} wrap="truncate-end" />
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export function drawTour(
  kit: Kit,
  tour: Tour,
  at: number,
  { bodyColumns: columns, isFocused }: { bodyColumns: number; isFocused: boolean },
  actions: Actions,
): RenderElement {
  const { go } = actions
  const { Box, Markdown } = kit
  const step = tour.steps[at] as Step
  const detail = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} gap={1}>
      <Markdown key={`note-${at}`} text={step.note} />
      {drawCode(kit, step)}
    </Box>
  )
  const tree = drawTree(kit, tour, at, go)

  return (
    <Box flexDirection="column" gap={1}>
      {drawHeader(kit, tour, at, isFocused, actions)}
      {drawJourney(kit, tour, at, go)}
      {columns >= WIDE ? (
        <Box flexDirection="row" gap={4}>
          <Box flexShrink={0}>{tree}</Box>
          {detail}
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {tree}
          {detail}
        </Box>
      )}
    </Box>
  )
}
