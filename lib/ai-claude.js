// Claude provider (paid). Set ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseIdeas } from './ai.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      cluster_id: z.string(),
      title: z.string(),
      description: z.string(),
      audience: z.string(),
      outline: z.array(z.string()),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  ),
});

let client;
export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function runClaude(system, userPrompt) {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(IdeasSchema) },
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off');
  if (!response.parsed_output) throw new Error('Claude output did not match the schema');
  return { ideas: parseIdeas(response.parsed_output), model: response.model };
}

export const CLAUDE_MODEL_NAME = MODEL;

// Generic JSON call for the guide writer (schema-agnostic; parses the JSON body).
export async function claudeJSON(system, userPrompt) {
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system: `${system}\n\nReturn ONLY valid JSON, no prose, no code fences.`,
    messages: [{ role: 'user', content: userPrompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}
