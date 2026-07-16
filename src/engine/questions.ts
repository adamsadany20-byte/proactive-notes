import type { AgentQuestion, Entities, Note, NoteKind } from '../types'
import { isSoftwareProject } from './classify'
import { SUBJECT_TOPICS } from './entities'

// Decide the single next question to ask for a note, given what we already
// know (entities) and what's already been asked/answered. Returns undefined
// when there's nothing left to ask.
export function nextQuestion(
  note: Note,
  kind: NoteKind,
  entities: Entities,
): AgentQuestion | undefined {
  const asked = new Set(note.askedFields)
  const answered = note.answers

  const has = (field: string) => field in answered || asked.has(field)

  switch (kind) {
    case 'academic': {
      if (!entities.date && !has('date')) {
        return {
          id: 'q-date',
          field: 'date',
          text: 'When is it?',
          chips: ['Tomorrow', 'This Friday', 'Next Monday', 'In 2 weeks'],
          placeholder: 'e.g. next Thursday',
        }
      }
      const topicsKnown =
        entities.topics.length > 0 || 'topics' in answered
      if (!topicsKnown && !has('topics')) {
        const subj = entities.subject
        const chips = subj ? SUBJECT_TOPICS[subj]?.slice(0, 5) : undefined
        return {
          id: 'q-topics',
          field: 'topics',
          text: 'What topics does it cover?',
          chips,
          placeholder: 'List the topics, separated by commas',
        }
      }
      if (!has('confidence-level')) {
        return {
          id: 'q-confidence',
          field: 'confidence-level',
          text: 'Which of these feels shakiest right now?',
          chips: entities.topics.length
            ? entities.topics.slice(0, 4)
            : ['All of it', 'Not sure yet'],
          placeholder: 'Anything you want to prioritise',
        }
      }
      return undefined
    }

    case 'event': {
      if (entities.knownEvent && !has('attend')) {
        return {
          id: 'q-attend',
          field: 'attend',
          text: `Want me to keep ${entities.knownEvent.name} on your radar?`,
          chips: ['Yes, watch it', 'Just summarise after', 'Ignore'],
        }
      }
      if (!entities.knownEvent && !entities.date && !has('date')) {
        return {
          id: 'q-event-date',
          field: 'date',
          text: 'When is it?',
          chips: ['Today', 'This weekend', 'Next week'],
          placeholder: 'e.g. Saturday 8pm',
        }
      }
      if (!has('briefing')) {
        return {
          id: 'q-briefing',
          field: 'briefing',
          text: 'Want a highlights summary put together for afterwards?',
          chips: ['Yes please', 'No thanks'],
        }
      }
      return undefined
    }

    case 'project': {
      const software = isSoftwareProject(note.text)
      // The stack question only makes sense for a software build. A presentation
      // or an SEO push is a project too — it just skips straight to scoping.
      if (software && !has('stack')) {
        return {
          id: 'q-stack',
          field: 'stack',
          text: "What's the stack — or should I suggest one?",
          chips: ['React + Node', 'SwiftUI', 'Python', 'Suggest one'],
          placeholder: 'Languages / frameworks',
        }
      }
      if (!has('timeline')) {
        return {
          id: 'q-timeline',
          field: 'timeline',
          text: 'Rough timeline?',
          chips: ['A weekend', '2 weeks', '1 month', 'Open-ended'],
        }
      }
      if (!has('team')) {
        return {
          id: 'q-team',
          field: 'team',
          text: 'Solo or with a team?',
          chips: ['Solo', 'Small team'],
        }
      }
      if (!has('goal')) {
        return {
          id: 'q-goal',
          field: 'goal',
          text: "What's the main goal?",
          chips: software
            ? ['Learn', 'Ship to users', 'Portfolio piece', 'Make money']
            : ['Get it done', 'Make it great', 'Hit a deadline'],
          placeholder: 'One line is fine',
        }
      }
      return undefined
    }

    case 'goal': {
      if (!has('cadence')) {
        return {
          id: 'q-cadence',
          field: 'cadence',
          text: 'How often do you want to do this?',
          chips: ['Daily', '3× a week', 'Weekly'],
        }
      }
      if (!has('target')) {
        return {
          id: 'q-target',
          field: 'target',
          text: "What's the target you're aiming for?",
          placeholder: 'e.g. run 5k, read 12 books',
        }
      }
      return undefined
    }

    case 'tasks': {
      if (!has('deadline')) {
        return {
          id: 'q-deadline',
          field: 'deadline',
          text: 'Is there a deadline for these?',
          chips: ['Today', 'This week', 'No rush'],
        }
      }
      return undefined
    }

    case 'purchase': {
      if (!entities.amounts?.length && !has('budget')) {
        return {
          id: 'q-budget',
          field: 'budget',
          text: "What's your budget?",
          chips: ['Under £50', '£50–150', '£150–500', 'Flexible'],
          placeholder: 'e.g. around £200',
        }
      }
      if (!has('priorities')) {
        return {
          id: 'q-priorities',
          field: 'priorities',
          text: 'What matters most to you here?',
          chips: ['Price', 'Quality', 'Reviews', 'Warranty'],
          placeholder: 'e.g. price, battery life, reviews',
        }
      }
      if (!has('timing')) {
        return {
          id: 'q-timing',
          field: 'timing',
          text: 'When do you need it by?',
          chips: ['ASAP', 'This month', 'No rush'],
        }
      }
      return undefined
    }

    default:
      return undefined
  }
}
