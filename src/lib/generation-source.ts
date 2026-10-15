export type GenerationSource = 'openai' | 'claude' | 'curated_fallback'

export function isGenerationSource(value: unknown): value is GenerationSource {
  return value === 'openai' || value === 'claude' || value === 'curated_fallback'
}
