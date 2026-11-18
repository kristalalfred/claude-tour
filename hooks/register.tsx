import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Place, Tour } from '../types'
import { load, prune, save } from './saved'
import { buildTour, spanText } from './tour'
import type { Reader } from './tour'
import { drawTour } from './view'

const PANE = 'tour'
const TOOL = 'mcp__tour__show'
const ROWS = 40
const COLUMNS = 100

const tours = atom({ plugin: 'tour', key: 'tours' } as const, [] as Tour[], { shape: 'tours-1' })
const place = atom({ plugin: 'tour', key: 'place' } as const, null as Place | null, {
  shape: 'place-1',
})

const DESCRIPTION = [
  'Opens a guided code tour in a pane beside the chat: a journey graph of the steps, a file tree of the files involved, and a code viewer that highlights each step while its note explains it. The person steps through it at their own pace.',
  'Use it when the person asks how something works across code, such as how a request travels from a handler through the domain layer to the database. Read the code first so every file and line range is exact, then order the steps the way control or data flows.',
  'Each note stands on its own next to its code. After the tour opens, reply in a sentence or two; do not repeat the notes in the reply.',
].join('\n\n')

const INPUT_SCHEMA = {
  type: 'object',
  required: ['title', 'steps'],
  properties: {
    title: {
      type: 'string',
      description: 'The question the tour answers, as a short headline: "How an order reaches the database".',
    },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['title', 'file', 'lines', 'note'],
        properties: {
          title: {
            type: 'string',
            description: "The step's node in the journey graph, one to four words, usually the function or component: \"OrderService.place\".",
          },
          file: {
            type: 'string',
            description: 'The file, relative to the working directory or absolute.',
          },
          lines: {
            type: 'string',
            description: 'The one range of lines shown, such as "30-52": the function or block the step is about, with a little context.',
          },
          highlight: {
            type: 'string',
            description: 'The lines within that range the note talks about, such as "34-36, 41". Left out, the whole range is highlighted.',
          },
          note: {
            type: 'string',
            description: 'Markdown shown beside the code: what happens here and why, what goes in and comes out, and how it hands off to the next step. Two to six sentences.',
          },
        },
      },
    },
  },
} as const

function readerOf($: EngineInterface): Reader {
  return {
    isReadable: async path => {
      const { decision } = await $.tool.check({ tool: 'Read', input: { file_path: path } })

      return decision !== 'deny'
    },
    read: path => $.fs.read(path).then(
      text => text,
      () => undefined,
    ),
  }
}

async function showing($: EngineInterface): Promise<{ tour: Tour; step: number } | undefined> {
  const list = await read($, tours)
  const at = await read($, place)
  const tour = list.find(candidate => candidate.id === at?.id) ?? list.at(-1)

  if (tour === undefined) {
    return undefined
  }
  const step = Math.min(Math.max(at?.id === tour.id ? at.step : 0, 0), tour.steps.length - 1)

  return { tour, step }
}

async function restore($: EngineInterface): Promise<void> {
  const messages = await $.session.messages()

  if (!Array.isArray(messages)) {
    return
  }
  const ids = messages
    .flatMap(message => message.toolUses)
    .filter(use => use.tool === TOOL && use.isError !== true)
    .map(use => use.tool_use_id)
  const found = (await Promise.all(ids.map(id => load($, id)))).filter(saved => saved !== undefined)
  const latest = found.at(-1)

  if (latest === undefined) {
    return
  }
  await update($, tours, list => [
    ...list.filter(known => !found.some(saved => saved.tour.id === known.id)),
    ...found.map(saved => saved.tour),
  ])
  await update($, place, at => at ?? { id: latest.tour.id, step: latest.step })
}

async function open($: EngineInterface, tour: Tour, step: number) {
  await update($, place, () => ({ id: tour.id, step }))

  return $.ui.open({ id: PANE, title: tour.title, focus: true, rows: ROWS, columns: COLUMNS })
}

let isFocusOwed = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'show',
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({ name: 'tour', description: 'Open the latest code tour' })
    await prune($)
    await restore($)

    return next(e)
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const root = await $.session.cwd()
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? crypto.randomUUID()
    const built = await buildTour(id, input, root, readerOf($))

    if ('problems' in built) {
      return { deny: `The tour was not opened:\n- ${built.problems.join('\n- ')}` }
    }
    const { tour } = built

    await update($, tours, list => [...list.filter(known => known.id !== tour.id), tour])
    await save($, tour, 0)
    const opened = await open($, tour, 0)

    isFocusOwed = opened.isPlaced
    const count = `${tour.steps.length} step${tour.steps.length === 1 ? '' : 's'}`

    return {
      result: opened.isPlaced
        ? `The tour "${tour.title}" is open with ${count}.`
        : `The tour "${tour.title}" (${count}) is ready, but the terminal is too narrow to open it unasked. Tell the person to run /tour to open it.`,
    }
  })

  on('command.run', { command: 'tour' }, async $ => {
    const shown = (await showing($)) ?? (await restore($).then(() => showing($)))

    if (shown === undefined) {
      return { text: 'No tour yet.' }
    }
    await open($, shown.tour, shown.step)

    return { text: `Opened "${shown.tour.title}".` }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (!isFocusOwed || e.agentId !== undefined) {
      return done
    }
    isFocusOwed = false
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE && !pane.isFocused)
    const shown = isOpen ? await showing($) : undefined

    if (shown !== undefined) {
      await $.ui.open({ id: PANE, title: shown.tour.title, focus: true, rows: ROWS, columns: COLUMNS })
    }

    return done
  })

  on('prompt.submit', async ($, e, next) => {
    const panes = await $.ui.panes()
    const shown = panes.some(pane => pane.id === PANE && pane.isShown) ? await showing($) : undefined
    const step = shown?.tour.steps[shown.step]

    if (shown === undefined || step === undefined || e.command !== undefined) {
      return next(e)
    }
    const where = `The person has the tour "${shown.tour.title}" open at step ${shown.step + 1} of ${shown.tour.steps.length}, "${step.title}" (${step.path}:${spanText(step.window)}).`

    return next({ ...e, context: [...(e.context ?? []), where] })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const shown = await showing($)

    if (shown === undefined) {
      const { Text } = kit

      return <Text dimColor>No tour yet.</Text>
    }
    const { tour } = shown
    const go = async (step: number) => {
      if (step < 0 || step >= tour.steps.length) {
        return
      }
      await update($, place, () => ({ id: tour.id, step }))
      await save($, tour, step)
    }

    const close = () => $.ui.close({ id: PANE })

    return drawTour(kit, tour, shown.step, e.props, { go, close })
  })

  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    const input = e.props.input as { title?: unknown; steps?: unknown }

    if (e.props.isExpanded === true || e.props.isErrored || typeof input.title !== 'string') {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const steps = Array.isArray(input.steps) ? (input.steps as { title?: unknown }[]) : []
    const titles = steps.map(step => (typeof step.title === 'string' ? step.title : '…'))
    const tour = (await read($, tours)).find(known => known.id === e.props.tool_use_id)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {e.props.isRunning ? <Text dimColor>⏺</Text> : <Text color="success">⏺</Text>}
          <Text bold>Tour</Text>
          <Text>{input.title}</Text>
          {tour !== undefined && (
            <Button key="open" dimColor onPress={() => open($, tour, 0)}>
              open
            </Button>
          )}
        </Box>
        <Box flexDirection="row" paddingLeft={2}>
          <Text dimColor wrap="wrap">
            ⎿  {titles.join(' → ')}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    if (e.props.isExpanded === true || e.props.isErrored) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

