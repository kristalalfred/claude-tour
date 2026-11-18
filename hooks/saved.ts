import type { EngineInterface } from 'claude-code'

import type { Tour } from '../types'

const PREFIX = 'tour:'
const SHAPE = 1
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

export type Saved = { shape: typeof SHAPE; usedAt: number; step: number; tour: Tour }

function isSaved(value: unknown): value is Saved {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const saved = value as Partial<Saved>

  return (
    saved.shape === SHAPE &&
    typeof saved.usedAt === 'number' &&
    typeof saved.step === 'number' &&
    typeof saved.tour?.id === 'string' &&
    Array.isArray(saved.tour.steps)
  )
}

export async function save($: EngineInterface, tour: Tour, step: number): Promise<void> {
  const saved: Saved = { shape: SHAPE, usedAt: await $.clock.now(), step, tour }

  await $.store.set(PREFIX + tour.id, saved)
}

export async function load($: EngineInterface, id: string): Promise<Saved | undefined> {
  const value = await $.store.get(PREFIX + id)

  return isSaved(value) ? value : undefined
}

export async function prune($: EngineInterface): Promise<void> {
  const oldest = (await $.clock.now()) - KEEP_MS

  for (const key of await $.store.keys()) {
    if (!key.startsWith(PREFIX)) {
      continue
    }
    const value = await $.store.get(key)

    if (!isSaved(value) || value.usedAt < oldest) {
      await $.store.delete(key)
    }
  }
}
