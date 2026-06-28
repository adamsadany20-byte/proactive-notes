import type { NoteKind, SegmentType } from '../types'

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
export const KIND_META: Record<NoteKind, KindMeta> = {
  academic: {
    label: 'Test prep',
    tint: 'var(--academic)',
    tintSoft: 'var(--academic-soft)',
    tintInk: '#1a6fc4',
    icon: '🎓',
  },
  event: {
    label: 'Event',
    tint: 'var(--event)',
    tintSoft: 'var(--event-soft)',
    tintInk: '#b65e1f',
    icon: '📅',
  },
  project: {
    label: 'Project',
    tint: 'var(--project)',
    tintSoft: 'var(--project-soft)',
    tintInk: '#0a8c68',
    icon: '🛠️',
  },
  goal: {
    label: 'Goal',
    tint: 'var(--goal)',
    tintSoft: 'var(--goal-soft)',
    tintInk: '#c42b62',
    icon: '🎯',
  },
  tasks: {
    label: 'Tasks',
    tint: 'var(--tasks)',
    tintSoft: 'var(--tasks-soft)',
    tintInk: '#6741d9',
    icon: '✓',
  },
  general: {
    label: 'Note',
    tint: 'var(--general)',
    tintSoft: 'var(--general-soft)',
    tintInk: '#5b6076',
    icon: '📝',
  },
  unknown: {
    label: '',
    tint: 'var(--general)',
    tintSoft: 'var(--general-soft)',
    tintInk: '#5b6076',
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

export const SEGMENT_ICON: Record<SegmentType, string> = {
  calendar: '📆',
  checklist: '☑️',
  flashcards: '🃏',
  schedule: '🗓️',
  'project-board': '📋',
  'goal-tracker': '🎯',
  'event-alert': '✨',
}
