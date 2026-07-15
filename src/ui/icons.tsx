import type { FC, SVGProps } from 'react'
import type { NoteKind, SegmentType } from '../types'

// ---------------------------------------------------------------------------
// Evolve's own icon set — hand-drawn strokes, not a stock library.
//
// Two signature motifs tie every glyph to the brand:
//   • the "tucked corner": three soft corners and one pulled deep in, echoing
//     the card silhouette (--radius-notch) across pages, calendars, frames;
//   • the six-point star from the logo, reused as the accent/star mark.
// All icons inherit currentColor and scale with font-size (width/height 1em).
// ---------------------------------------------------------------------------

export type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

// The logo's six-point star, as a filled mark. Used for AI/insight moments.
export function StarSixIcon(props: IconProps) {
  return (
    <Svg {...props} stroke="none" fill="currentColor">
      <path d="M12 2.5 L14.1 8.36 L20.2 7.25 L16.2 12 L20.2 16.75 L14.1 15.64 L12 21.5 L9.9 15.64 L3.8 16.75 L7.8 12 L3.8 7.25 L9.9 8.36 Z" />
    </Svg>
  )
}

// A page with the tucked bottom-left corner and two written lines — Notes.
export function PageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.5 H16.5 C18.2 3.5 19.5 4.8 19.5 6.5 V17.5 C19.5 19.2 18.2 20.5 16.5 20.5 H10.5 C7.2 20.5 4.5 17.8 4.5 14.5 V7 C4.5 5 6 3.5 8 3.5 Z" />
      <path d="M9 9.4 H15.6" />
      <path d="M9 13 H13.2" />
    </Svg>
  )
}

// A quill nib mid-stroke — Write.
export function QuillIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19.6 4.2 C14.2 4.6 10 7.4 8.4 12.2 L6.6 17.4 L11.8 15.6 C16.6 14 19.3 9.7 19.6 4.2 Z" />
      <path d="M8.4 12.2 L12.8 10.8" />
      <path d="M4.2 20.2 C6.6 19.5 8.9 19.5 11.3 20.2" />
    </Svg>
  )
}

// A calendar frame with the tucked corner, binding stubs, and one offset
// day-dot — deliberately not a symmetric grid.
export function DayGlyphIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 5.5 H17 C19 5.5 20.5 7 20.5 9 V16.5 C20.5 18.5 19 20 17 20 H10.5 C7.2 20 4.5 17.3 4.5 14 V8.5 C4.5 6.8 5.8 5.5 7.5 5.5 Z" />
      <path d="M8.5 3.2 V7" />
      <path d="M15.5 3.2 V7" />
      <circle cx="15.3" cy="13.6" r="1.8" fill="currentColor" stroke="none" />
    </Svg>
  )
}

// Capsule mic over a listening arc. `live` lets CSS animate the arc.
export function MicIcon({ live, ...rest }: IconProps & { live?: boolean }) {
  return (
    <Svg {...rest} className={`${rest.className ?? ''} ${live ? 'ico-live' : ''}`}>
      <path d="M12 3.6 C10 3.6 8.7 4.9 8.7 6.9 V11.1 C8.7 13.1 10 14.4 12 14.4 C14 14.4 15.3 13.1 15.3 11.1 V6.9 C15.3 4.9 14 3.6 12 3.6 Z" />
      <path className="mic-arc" d="M6.2 11.4 C6.2 14.9 8.7 17.2 12 17.2 C15.3 17.2 17.8 14.9 17.8 11.4" />
      <path d="M12 17.2 V20.4" />
    </Svg>
  )
}

// A full, rounded flame with a shouldered "kick" and a brighter inner tongue —
// the streak mark. Filled (like the star mark) so it reads as fire even at the
// ~10px nav-badge size; the inner tongue lifts to a hotter core in the ring.
// The two paths share currentColor; the tongue sits at lower opacity so a warm
// gradient reads without coupling the glyph to any theme variable.
export function FlameIcon(props: IconProps) {
  return (
    <Svg {...props} stroke="none" fill="currentColor">
      <path d="M12.2 2.4 C13.1 5.1 12.7 7.2 11.2 9 C9.5 11 7.2 12.4 7.2 15.3 C7.2 18.6 9.4 21 12.2 21 C15.1 21 17.2 18.6 17.2 15.4 C17.2 13.2 16.3 11.5 14.8 9.8 C14.5 11.1 13.9 11.9 13 12.4 C14.3 9.2 13.9 5.9 12.2 2.4 Z" />
      <path
        className="flame-core"
        d="M12.3 12.6 C11 13.9 10.4 15 10.4 16.1 C10.4 17.6 11.2 18.5 12.3 18.5 C13.5 18.5 14.3 17.5 14.3 16.1 C14.3 15 13.6 13.9 12.3 12.6 Z"
        opacity="0.5"
      />
    </Svg>
  )
}

// A two-leaf sprout — the not-yet-lit streak.
export function SproutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20.4 V11" />
      <path d="M12 13.2 C8.7 13.2 6.6 11.5 6.1 8.2 C9.6 8.2 11.6 9.9 12 13.2 Z" />
      <path d="M12 11 C12.4 7.7 14.5 6 18 6 C17.5 9.3 15.4 11 12 11 Z" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.6 V18.4" />
      <path d="M5.6 12 H18.4" />
    </Svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="M15.3 15.3 L20 20" />
    </Svg>
  )
}

// Bell with an offset ring-wave — reminders.
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.4 C9 4.4 7 6.7 7 9.9 C7 13.3 6.1 14.8 5.1 16.1 C4.8 16.5 5.05 17.1 5.6 17.1 H18.4 C18.95 17.1 19.2 16.5 18.9 16.1 C17.9 14.8 17 13.3 17 9.9 C17 6.7 15 4.4 12 4.4 Z" />
      <path d="M10.2 19.4 C10.7 20.1 11.3 20.4 12 20.4 C12.7 20.4 13.3 20.1 13.8 19.4" />
      <path d="M18.9 4.6 C20 5.6 20.6 6.9 20.8 8.4" opacity="0.6" />
    </Svg>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 10 L12 15 L17 10" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 12.8 L10 17.2 L18.5 7.4" />
    </Svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 7 L17 17" />
      <path d="M17 7 L7 17" />
    </Svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6 V12 L15.3 13.9" />
    </Svg>
  )
}

// Three sliders with offset knobs — schedule/tuning.
export function TuneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7.3 H19.5" />
      <circle cx="9.3" cy="7.3" r="2" fill="var(--panel, #fff)" />
      <path d="M4.5 12 H19.5" />
      <circle cx="15" cy="12" r="2" fill="var(--panel, #fff)" />
      <path d="M4.5 16.7 H19.5" />
      <circle cx="7.5" cy="16.7" r="2" fill="var(--panel, #fff)" />
    </Svg>
  )
}

// Two offset study cards, the front one starred — flashcards.
export function CardsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.6 4.9 L17.9 6.1 C19 6.25 19.7 7.2 19.5 8.3 L18 17.1" opacity="0.55" />
      <rect x="4.5" y="7" width="11.5" height="13" rx="2.4" />
      <path
        d="M10.25 10.1 L11 12 L13 12.2 L11.5 13.5 L11.95 15.5 L10.25 14.4 L8.55 15.5 L9 13.5 L7.5 12.2 L9.5 12 Z"
        fill="currentColor"
        stroke="none"
        opacity="0.75"
      />
    </Svg>
  )
}

// Checklist rows, first ticked — topic lists.
export function ListCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.2" y="4.6" width="5.4" height="5.4" rx="1.7" />
      <path d="M6 7.3 L7.1 8.4 L8.6 6.4" strokeWidth={1.6} />
      <path d="M13 7.3 H19.8" />
      <rect x="4.2" y="14" width="5.4" height="5.4" rx="1.7" />
      <path d="M13 16.7 H19.8" />
    </Svg>
  )
}

// Three uneven kanban columns — project board.
export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4.5" width="4.3" height="15" rx="1.7" />
      <rect x="9.85" y="4.5" width="4.3" height="9" rx="1.7" />
      <rect x="15.7" y="4.5" width="4.3" height="12" rx="1.7" />
    </Svg>
  )
}

// Rings with an off-centre landed dot — goals.
export function TargetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7.7" />
      <circle cx="12" cy="12" r="3.9" opacity="0.6" />
      <circle cx="13.4" cy="10.6" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

// A round-handled basket — purchases.
export function BasketIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 9.6 H19 L17.7 17.1 C17.5 18.3 16.6 19.1 15.4 19.1 H8.6 C7.4 19.1 6.5 18.3 6.3 17.1 L5 9.6 Z" />
      <path d="M9 9.6 C9 6.9 10.2 5 12 5 C13.8 5 15 6.9 15 9.6" />
    </Svg>
  )
}

// Mortarboard — academic.
export function CapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.2 L21 9.2 L12 13.2 L3 9.2 Z" />
      <path d="M6.6 11.2 V15 C6.6 16.7 9 18.1 12 18.1 C15 18.1 17.4 16.7 17.4 15 V11.2" />
      <path d="M21 9.2 V13.6" opacity="0.6" />
    </Svg>
  )
}

export function TrophyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4.8 H16 V9.4 C16 12 14.4 13.9 12 13.9 C9.6 13.9 8 12 8 9.4 Z" />
      <path d="M8 6.4 H5.4 C5.4 9 6.4 10.5 8 10.9" />
      <path d="M16 6.4 H18.6 C18.6 9 17.6 10.5 16 10.9" />
      <path d="M12 13.9 V17" />
      <path d="M8.8 19.6 H15.2" />
      <path d="M10 17 H14 L14.6 19.6 H9.4 Z" strokeWidth={1.6} />
    </Svg>
  )
}

// Heart with a small pulse notch — health & wellbeing.
export function HeartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19 C12 19 4.5 14.4 4.5 9.4 C4.5 6.9 6.3 5.2 8.5 5.2 C10 5.2 11.3 6 12 7.3 C12.7 6 14 5.2 15.5 5.2 C17.7 5.2 19.5 6.9 19.5 9.4 C19.5 14.4 12 19 12 19 Z" />
      <path d="M7 11.6 H9.6 L11 9.4 L13 13.4 L14.2 11.6 H17" strokeWidth={1.5} opacity="0.7" />
    </Svg>
  )
}

// A coin with an offset second coin — money / finance.
export function CoinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.4" cy="10.4" r="6" />
      <path d="M10.4 7.4 V13.4 M8.7 8.9 H11.4 C12 8.9 12.4 9.3 12.4 9.9 C12.4 10.5 12 10.9 11.4 10.9 H9 M9 10.9 H11.6" strokeWidth={1.5} />
      <path d="M15.8 15.2 A6 6 0 0 1 8.9 18.2" opacity="0.55" />
    </Svg>
  )
}

// A banking plane at a slight climb — travel.
export function PlaneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 13.4 L20 8 L18.4 12.4 C18.1 13.2 17.4 13.8 16.5 14 L6.5 16.3 L5.4 14.2 L9.5 12.6 L7.8 11.2 L5.8 11.8 Z" />
    </Svg>
  )
}

// A lidded pot with rising steam — recipe / cooking.
export function PotIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.4 11.4 H18.6 V15.4 C18.6 17.1 17.2 18.5 15.5 18.5 H8.5 C6.8 18.5 5.4 17.1 5.4 15.4 Z" />
      <path d="M4.2 11.4 H19.8" />
      <path d="M9.5 8.4 C9.5 7.2 8.7 6.9 8.7 5.9 M14.5 8.4 C14.5 7.2 13.7 6.9 13.7 5.9" opacity="0.7" strokeWidth={1.5} />
    </Svg>
  )
}

// A film clapper — watchlist / media.
export function FilmIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.3" y="9.2" width="15.4" height="10" rx="2.2" />
      <path d="M4.7 9.2 L7.6 5.6 L11 8.2 M9.4 5 L12.8 7.7 M14.2 4.6 L17.4 7.4" strokeWidth={1.5} opacity="0.75" />
      <path d="M11 12 L14.6 14.1 L11 16.2 Z" fill="currentColor" stroke="none" opacity="0.7" />
    </Svg>
  )
}

// ---------------------------------------------------------------------------
// Maps: segment types + note kinds → their glyphs. These replace the old emoji
// so every surface draws from the same hand.
// ---------------------------------------------------------------------------

export const SEGMENT_ICONS: Record<SegmentType, FC<IconProps>> = {
  calendar: DayGlyphIcon,
  checklist: ListCheckIcon,
  flashcards: CardsIcon,
  schedule: ClockIcon,
  'project-board': BoardIcon,
  'streak-tracker': FlameIcon,
  'event-alert': StarSixIcon,
  'purchase-planner': BasketIcon,
}

export const KIND_ICONS: Partial<Record<NoteKind, FC<IconProps>>> = {
  academic: CapIcon,
  event: DayGlyphIcon,
  project: BoardIcon,
  goal: TargetIcon,
  tasks: ListCheckIcon,
  purchase: BasketIcon,
  health: HeartIcon,
  finance: CoinIcon,
  travel: PlaneIcon,
  recipe: PotIcon,
  media: FilmIcon,
  general: PageIcon,
}
