import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { buildTour, normalize, parseSpans, relative, resolve } from '../hooks/tour'
import type { Reader } from '../hooks/tour'
import { treeRows } from '../hooks/tree'
import { filesOf, runsOf } from '../hooks/view'

const ROOT = '/repo'

const FILES: Record<string, string> = {
  '/repo/src/api/orders.ts': [
    "import { placeOrder } from '../domain/order'",
    '',
    'export async function postOrder(req, res) {',
    '  const order = await placeOrder(req.body)',
    '  res.status(201).json(order)',
    '}',
    '',
  ].join('\n'),
  '/repo/src/domain/order.ts': [
    "import { insertOrder } from '../db/orders'",
    '',
    'export async function placeOrder(input) {',
    '\tif (input.items.length === 0) throw new Error("empty")',
    '  return insertOrder({ ...input, placedAt: new Date() })',
    '}',
  ].join('\n'),
  '/repo/src/db/orders.ts': [
    'export function insertOrder(order) {',
    "  return sql`insert into orders ${order}`",
    '}',
  ].join('\n'),
  '/repo/.env': 'SECRET=1',
}

const reader: Reader = {
  isReadable: async path => !path.endsWith('.env'),
  read: async path => FILES[path],
}

const STEPS = [
  {
    title: 'postOrder',
    file: 'src/api/orders.ts',
    lines: '3-6',
    highlight: '4',
    note: 'The handler passes the body on.',
  },
  {
    title: 'placeOrder',
    file: 'src/domain/order.ts',
    lines: '3-6',
    highlight: '4-5',
    note: 'The domain checks the items.',
  },
  { title: 'insertOrder', file: 'src/db/orders.ts', lines: '1-3', note: 'The row is written.' },
]

const PANE = {
  plugin: 'tour',
  component: 'Pane',
  requestId: 'tour',
  props: {
    title: 'How an order is stored',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('line ranges read as spans, and bad ones are refused', () => {
  expect(parseSpans('30-52')).toEqual([{ first: 30, last: 52 }])
  expect(parseSpans('34-36, 41')).toEqual([
    { first: 34, last: 36 },
    { first: 41, last: 41 },
  ])
  expect(parseSpans(7)).toEqual([{ first: 7, last: 7 }])
  expect(parseSpans('12–14')).toEqual([{ first: 12, last: 14 }])
  expect(parseSpans('52-30')).toBeUndefined()
  expect(parseSpans('0-3')).toBeUndefined()
  expect(parseSpans('a-b')).toBeUndefined()
})

test('paths resolve against the root and show relative to it', () => {
  expect(normalize('/repo/./src/../lib//a.ts')).toBe('/repo/lib/a.ts')
  expect(resolve(ROOT, 'src/a.ts')).toBe('/repo/src/a.ts')
  expect(resolve(ROOT, '/elsewhere/b.ts')).toBe('/elsewhere/b.ts')
  expect(relative(ROOT, '/repo/src/a.ts')).toBe('src/a.ts')
  expect(relative(ROOT, '/elsewhere/b.ts')).toBe('/elsewhere/b.ts')
})

test('a tour keeps each step’s lines, tabs expanded', async () => {
  const built = await buildTour('t1', { title: 'Orders', steps: STEPS }, ROOT, reader)

  if (!('tour' in built)) {
    throw new Error(built.problems.join('; '))
  }
  const [, domain, db] = built.tour.steps

  expect(domain?.path).toBe('src/domain/order.ts')
  expect(domain?.lines[1]).toBe('    if (input.items.length === 0) throw new Error("empty")')
  expect(domain?.highlight).toEqual([{ first: 4, last: 5 }])
  expect(db?.highlight).toEqual([{ first: 1, last: 3 }])
})

test('every wrong step is named so the model can fix the call', async () => {
  const built = await buildTour(
    't2',
    {
      title: 'Orders',
      steps: [
        { ...STEPS[0], lines: '3-40' },
        { ...STEPS[1], highlight: '9' },
        { title: 'env', file: '.env', lines: '1', note: 'Secrets.' },
        { title: 'gone', file: 'src/gone.ts', lines: '1', note: 'Missing.' },
        { title: 'bare', file: 'src/db/orders.ts', lines: '1-2' },
      ],
    },
    ROOT,
    reader,
  )

  expect(built).toEqual({
    problems: [
      'step 1: src/api/orders.ts has 6 lines, so lines 3-40 run past its end',
      'step 2: highlight 9 lies outside lines 3-6',
      'step 3: reading .env is denied',
      'step 4: src/gone.ts was not found',
      'step 5: note is missing',
    ],
  })
})

test('the tree orders files by the step that first reaches them', () => {
  const rows = treeRows([
    { path: 'src/api/orders.ts', steps: [0] },
    { path: 'src/domain/order.ts', steps: [1, 3] },
    { path: 'src/domain/rules.ts', steps: [2] },
    { path: 'src/db/orders.ts', steps: [4] },
  ]).map(row => row.guide + row.name)

  expect(rows).toEqual([
    'src/',
    '├─ api/orders.ts',
    '├─ domain/',
    '│  ├─ order.ts',
    '│  └─ rules.ts',
    '└─ db/orders.ts',
  ])
})

test('highlighted and context lines split into runs', async () => {
  const built = await buildTour('t3', { title: 'Orders', steps: STEPS }, ROOT, reader)
  const step = 'tour' in built ? built.tour.steps[0] : undefined

  expect(step && runsOf(step).map(run => [run.first, run.lines.length, run.isLit])).toEqual([
    [3, 1, false],
    [4, 1, true],
    [5, 2, false],
  ])
  expect('tour' in built && filesOf(built.tour).map(file => file.steps)).toEqual([[0], [1], [2]])
})

test('the tool opens a pane that steps through the tour', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', () => ({ value: { command: 'tour' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__tour__show' } }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('fs.read', (_, e) => {
    const text = FILES[(e as { path: string }).path]

    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const called = await $.tool.call({
    tool: 'mcp__tour__show',
    title: 'How an order is stored',
    steps: STEPS,
  })

  expect(called.result).toBe('The tour "How an order is stored" is open with 3 steps.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const header = async () => (await ui.find({ type: 'Text', text: /^src\/.*:\d/ }))?.text

    expect(await header()).toBe('src/api/orders.ts:3-6')
    await ui.press({ key: 'next' })
    expect(await header()).toBe('src/domain/order.ts:3-6')
    await ui.press({ key: 'step-2' })
    expect(await header()).toBe('src/db/orders.ts:1-3')
    await ui.press({ key: 'prev' })
    expect(await header()).toBe('src/domain/order.ts:3-6')
    await ui.press({ key: 'step-0' })
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
})

test('a resumed session reopens its tours at the step it left', async ($, on) => {
  const built = await buildTour('call-1', { title: 'Orders', steps: STEPS }, ROOT, reader)
  const tour = 'tour' in built ? built.tour : undefined

  mock.clock(on)
  mock.store(on, { 'tour:call-1': { shape: 1, usedAt: 0, step: 2, tour } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'how are orders stored?', toolUses: [] },
      {
        role: 'assistant',
        text: '',
        toolUses: [{ tool_use_id: 'call-1', tool: 'mcp__tour__show', input: {} }],
      },
    ],
  }))
  on('command.register', () => ({ value: { command: 'tour' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__tour__show' } }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^src\/.*:\d/ }))?.text).toBe('src/db/orders.ts:1-3')
  await ui.unmount()
})

test('an unfocused pane shows how to give it the keys', async ($, on) => {
  const built = await buildTour('call-2', { title: 'Orders', steps: STEPS }, ROOT, reader)
  const tour = 'tour' in built ? built.tour : undefined

  mock.clock(on)
  mock.store(on, { 'tour:call-2': { shape: 1, usedAt: 0, step: 0, tour } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'call-2', tool: 'mcp__tour__show', input: {} }] }],
  }))
  on('command.register', () => ({ value: { command: 'tour' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__tour__show' } }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const unfocused = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, isFocused: false } })

  expect((await unfocused.find({ type: 'Text', text: /ctrl\+x/ }))?.text).toBe('ctrl+x tab')
  await unfocused.unmount()
  const focused = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await focused.find({ type: 'Text', text: /ctrl\+x/ })).toBeUndefined()
  await focused.unmount()
})

function answerSessionStart(on: On, id: string) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: 'mcp__tour__show', input: {} }] }],
  }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', () => ({ value: { command: 'tour' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__tour__show' } }))
}

const questions = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^› / })).map(found => found.text)

test('the first question forks the conversation with the step it was asked on', async ($, on) => {
  const built = await buildTour('call-3', { title: 'Orders', steps: STEPS }, ROOT, reader)
  const tour = 'tour' in built ? built.tour : undefined
  const spawned: { prompt: string; subagentType?: string }[] = []

  mock.clock(on)
  mock.store(on, { 'tour:call-3': { shape: 1, usedAt: 0, step: 1, tour } })
  answerSessionStart(on, 'call-3')
  on('agent.spawn', (_, e) => {
    const raw = e as unknown as { subagent_type?: string }

    spawned.push({ prompt: e.prompt, subagentType: e.subagentType ?? raw.subagent_type })

    return { deny: 'No agents in tests.' }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.input({ key: 'ask', text: '  Why check here?  ' })
  expect(spawned).toHaveLength(1)
  expect(spawned[0]?.subagentType).toBe('fork')
  expect(spawned[0]?.prompt).toContain('side thread')
  expect(spawned[0]?.prompt).toContain('step 2 of 3, "placeOrder" (src/domain/order.ts:3-6)')
  expect(spawned[0]?.prompt.endsWith('Why check here?')).toBe(true)
  expect(await questions(ui)).toEqual(['› Why check here?'])
  expect((await ui.find({ type: 'Text', text: 'No agents in tests.' }))?.text).toBe('No agents in tests.')
  await ui.unmount()
})

test('follow-ups go to the thread’s agent and answers land on their step', async ($, on) => {
  const built = await buildTour('call-4', { title: 'Orders', steps: STEPS }, ROOT, reader)
  const tour = 'tour' in built ? built.tour : undefined
  const thread = {
    id: 'call-4',
    agentId: 'agent-1',
    exchanges: [
      { step: 0, question: 'Why the body?', answer: 'It is the order.' },
      { step: 1, question: 'Left hanging?' },
    ],
  }
  const sent: { to: string; text: string }[] = []

  mock.clock(on)
  mock.store(on, { 'tour:call-4': { shape: 1, usedAt: 0, step: 0, tour, thread } })
  answerSessionStart(on, 'call-4')
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })

    return { isDelivered: true }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ran' }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await questions(ui)).toEqual(['› Why the body?'])
  expect(await ui.find({ key: 'answer-0' })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await questions(ui)).toEqual(['› Left hanging?'])
  expect(await ui.find({ type: 'Text', text: 'Interrupted before it answered.' })).toBeDefined()

  await ui.input({ key: 'ask', text: 'What does the check reject?' })
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toBe('agent-1')
  expect(sent[0]?.text).toContain('step 2 of 3')
  expect(sent[0]?.text).not.toContain('side thread')
  expect(await ui.find({ key: 'ask' })).toBeUndefined()

  await $.turn.complete({
    agentId: 'agent-1',
    answer: 'An order with no items.',
    reason: 'answer',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn-1',
  })
  expect(await questions(ui)).toEqual(['› Left hanging?', '› What does the check reject?'])
  expect(await ui.find({ key: 'answer-2' })).toBeDefined()
  expect(await ui.find({ key: 'ask' })).toBeDefined()
  await ui.unmount()

  const notice = await $.prompt.submit({
    text: '<task-notification>\n<task-id>agent-1</task-id>\n</task-notification>',
    origin: { kind: 'task-notification' },
    wait: false,
  })

  expect(notice).toEqual({ drop: '' })
  expect(
    await $.tool.call({ tool: 'Edit', agentId: 'agent-1', file_path: '/repo/x', old_string: 'a', new_string: 'b' }),
  ).toEqual({ deny: 'Questions about a tour only read code; they do not change files.' })
})
