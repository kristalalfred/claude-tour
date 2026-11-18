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

declare module 'claude-code' {
  interface PluginState {
    tour: {
      tours: Shaped<Tour[]>
      place: Shaped<Place | null>
    }
  }
}
