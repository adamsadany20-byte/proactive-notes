// Generate a complete, self-contained interactive React component for ANY
// described feature — curated to the user's note. Powered by Claude (Haiku) via
// the backend; only reachable when Broader AI is enabled.

import { generateFeatureApi, type AiBackend } from '../services/api'

export interface GeneratedComponentResult {
  code: string
  error?: string
}

function extractCode(raw: string): string {
  let code = raw
    .replace(/```(jsx|tsx|js|javascript)?\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()
  if (!code.includes('export')) code = `export default ${code}`
  return code
}

export async function generateCustomFeature(
  label: string,
  description: string,
  noteText: string,
  backend?: AiBackend,
): Promise<GeneratedComponentResult> {
  const result = await generateFeatureApi(label, description, noteText, backend)
  if (!result) {
    return {
      code: '',
      error: 'Could not reach the server. Is the backend running?',
    }
  }
  if (result.configured === false) {
    return {
      code: '',
      error: 'This AI tier has no API key configured on the server.',
    }
  }
  if (result.error) {
    return { code: '', error: result.error }
  }
  if (!result.code) {
    return { code: '', error: 'The AI tier returned an empty response.' }
  }

  const code = extractCode(result.code)
  if (!code.includes('function') && !code.includes('=>')) {
    return { code: '', error: 'Generated code was not a valid React component' }
  }
  return { code }
}
