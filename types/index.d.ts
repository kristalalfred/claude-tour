export type Span = { first: number; last: number }

export type Step = {
  title: string
  path: string
  window: Span
  highlight: Span[]
  lines: string[]
  note: string
}

export type Tour = { id: string; title: string; steps: Step[] }

export type Place = { id: string; step: number }

export type Exchange = { step: number; question: string; answer?: string; problem?: string }

export type Thread = { id: string; agentId?: string; exchanges: Exchange[] }

declare module 'claude-code' {
  interface PluginState {
    tour: {
      tours: Shaped<Tour[]>
      place: Shaped<Place | null>
      threads: Shaped<Thread[]>
    }
  }
}
