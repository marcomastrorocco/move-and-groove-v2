import 'server-only'

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5'
