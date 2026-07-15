import type { NoteKind } from '../types'

export interface KindMeta {
  label: string
  tint: string
  tintSoft: string
  tintInk: string
  icon: string
}

// Maps a note kind to its colour identity + label. The CSS reads `--tint`,
// `--tint-soft`, `--tint-ink` from inline style so every nested element inherits
// the right accent.
// tintInk derives from the kind's base hue mixed toward the theme's ink colour,
// so kind labels stay legible against the soft tint in both light and dark mode.
const ink = (base: string) => `color-mix(in srgb, ${base} 70%, var(--ink))`

export const KIND_META: Record<NoteKind, KindMeta> = {
  academic: {
    label: 'Test prep',
    tint: 'var(--academic)',
    tintSoft: 'var(--academic-soft)',
    tintInk: ink('var(--academic)'),
    icon: '🎓',
  },
  event: {
    label: 'Event',
    tint: 'var(--event)',
    tintSoft: 'var(--event-soft)',
    tintInk: ink('var(--event)'),
    icon: '📅',
  },
  project: {
    label: 'Project',
    tint: 'var(--project)',
    tintSoft: 'var(--project-soft)',
    tintInk: ink('var(--project)'),
    icon: '🛠️',
  },
  goal: {
    label: 'Goal',
    tint: 'var(--goal)',
    tintSoft: 'var(--goal-soft)',
    tintInk: ink('var(--goal)'),
    icon: '🎯',
  },
  tasks: {
    label: 'Tasks',
    tint: 'var(--tasks)',
    tintSoft: 'var(--tasks-soft)',
    tintInk: ink('var(--tasks)'),
    icon: '✓',
  },
  purchase: {
    label: 'Purchase',
    tint: 'var(--purchase)',
    tintSoft: 'var(--purchase-soft)',
    tintInk: ink('var(--purchase)'),
    icon: '🛒',
  },
  health: {
    label: 'Health',
    tint: 'var(--health)',
    tintSoft: 'var(--health-soft)',
    tintInk: ink('var(--health)'),
    icon: '❤️',
  },
  finance: {
    label: 'Finance',
    tint: 'var(--finance)',
    tintSoft: 'var(--finance-soft)',
    tintInk: ink('var(--finance)'),
    icon: '💷',
  },
  travel: {
    label: 'Travel',
    tint: 'var(--travel)',
    tintSoft: 'var(--travel-soft)',
    tintInk: ink('var(--travel)'),
    icon: '✈️',
  },
  recipe: {
    label: 'Recipe',
    tint: 'var(--recipe)',
    tintSoft: 'var(--recipe-soft)',
    tintInk: ink('var(--recipe)'),
    icon: '🍳',
  },
  media: {
    label: 'Watchlist',
    tint: 'var(--media)',
    tintSoft: 'var(--media-soft)',
    tintInk: ink('var(--media)'),
    icon: '🎬',
  },
  general: {
    label: 'Note',
    tint: 'var(--general)',
    tintSoft: 'var(--general-soft)',
    tintInk: ink('var(--general)'),
    icon: '📝',
  },
  unknown: {
    label: '',
    tint: 'var(--general)',
    tintSoft: 'var(--general-soft)',
    tintInk: ink('var(--general)'),
    icon: '',
  },
}

export function tintVars(kind: NoteKind): React.CSSProperties {
  const m = KIND_META[kind]
  return {
    ['--tint' as any]: m.tint,
    ['--tint-soft' as any]: m.tintSoft,
    ['--tint-ink' as any]: m.tintInk,
  }
}

// Segment/kind glyphs live in ui/icons.tsx (SEGMENT_ICONS / KIND_ICONS) — the
// app draws its own icon set rather than emoji.
