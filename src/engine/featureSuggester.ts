// Ask the AI (Claude Haiku, via the backend) what tools/resources would help
// THIS note. Returns a dynamic, context-curated list — not a fixed menu.
// Only reachable when the user has Broader AI enabled.

import {
  suggestFeaturesApi,
  type AiBackend,
  type FeatureSuggestion,
} from '../services/api'

export type { FeatureSuggestion }

export async function suggestFeatures(
  noteText: string,
  backend?: AiBackend,
  context?: string,
): Promise<{ suggestions: FeatureSuggestion[]; error?: string }> {
  if (!noteText.trim()) return { suggestions: [] }
  const { suggestions, error } = await suggestFeaturesApi(noteText, backend, context)
  return {
    suggestions: suggestions
      .filter((s) => s?.label && s?.description)
      .map((s) => ({
        label: String(s.label),
        icon: typeof s.icon === 'string' && s.icon ? s.icon : '✦',
        description: String(s.description),
      })),
    error,
  }
}
