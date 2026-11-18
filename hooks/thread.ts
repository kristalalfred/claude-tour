import type { Exchange, Thread, Tour } from '../types'
import { spanText } from './tour'

export type Outcome = { answer: string } | { problem: string }

const INTERRUPTED = 'Interrupted before it answered.'

export const isPending = (exchange: Exchange) =>
  exchange.answer === undefined && exchange.problem === undefined

export const isBusy = (thread: Thread | undefined) => thread?.exchanges.some(isPending) ?? false

export function framing(tour: Tour, step: number, question: string, isFirst: boolean): string {
  const at = tour.steps[step]
  const where =
    at === undefined
      ? ''
      : `They are at step ${step + 1} of ${tour.steps.length}, "${at.title}" (${at.path}:${spanText(at.window)}).\n\n`
  const opening = isFirst
    ? `The person is reading the tour "${tour.title}" and asks about it in a side thread inside the tour pane, apart from the main conversation. Answer each question they send here directly, in Markdown that reads well in a narrow pane. Read code when the answer needs it, but do not change any files.\n\n`
    : ''

  return `${opening}${where}${question}`
}

export function asked(thread: Thread, step: number, question: string): Thread {
  return { ...thread, exchanges: [...thread.exchanges, { step, question }] }
}

export function settled(thread: Thread, outcome: Outcome): Thread {
  const index = thread.exchanges.findIndex(isPending)

  if (index === -1) {
    return thread
  }
  const exchanges = thread.exchanges.map((exchange, at) =>
    at === index ? { ...exchange, ...outcome } : exchange,
  )

  return { ...thread, exchanges }
}

export function interrupted(thread: Thread): Thread {
  const exchanges = thread.exchanges.map(exchange =>
    isPending(exchange) ? { ...exchange, problem: INTERRUPTED } : exchange,
  )

  return { ...thread, exchanges }
}

export function isNoticeOf(text: string, agentIds: readonly string[]): boolean {
  return agentIds.some(id => text.includes(`<task-id>${id}</task-id>`))
}
