import type { Config } from './config.js';

export type RewriteMode = 'clean' | 'spell' | 'polish' | 'professional' | 'shorter' | 'friendly';

type GroqChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

const instructions: Record<RewriteMode, string> = {
  clean: "Clean up dictation artifacts, punctuation, grammar, and structure. Preserve the speaker's meaning.",
  spell: 'Correct spelling mistakes, capitalization, and obvious punctuation only. Do not rewrite, summarize, translate, change wording, or alter the tone.',
  polish: 'Polish this written text. Fix grammar, punctuation, spelling, clarity, and sentence flow while preserving the original voice, tone, and meaning. Do not make it more formal unless needed.',
  professional: 'Rewrite the text to sound clear, polished, and professional. Preserve the meaning.',
  shorter: 'Make the text shorter and punchier. Preserve the core meaning.',
  friendly: 'Rewrite the text to sound warm, friendly, and natural. Preserve the meaning.'
};

export function normalizeTranscriptText(text: string) {
  return text
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '')
    .trim();
}

export async function rewriteText(text: string, config: Config, mode: RewriteMode = 'polish') {
  const input = normalizeTranscriptText(text);
  if (!input) throw new Error('Nothing to rewrite yet.');

  const key = config.keys?.groq;
  if (!key) throw new Error('Auto polish needs a Groq API key. Run: wisper polish on');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.polishModel || 'llama-3.3-70b-versatile',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are a dictation cleanup engine. Return only the rewritten text, with no explanation.'
        },
        {
          role: 'user',
          content: `${instructions[mode]}\n\nText:\n${input}`
        }
      ]
    })
  });

  const body = await response.json().catch(() => ({})) as GroqChatResponse;
  if (!response.ok) throw new Error(body.error?.message || `Groq rewrite failed: HTTP ${response.status}`);

  const rewritten = body.choices?.[0]?.message?.content?.trim() || '';
  if (!rewritten) throw new Error('Groq returned an empty rewrite.');
  return rewritten;
}

export async function polishDictationIfEnabled(text: string, config: Config) {
  const cleaned = normalizeTranscriptText(text);
  if (!config.autoPolish) return cleaned;
  const polished = await rewriteText(cleaned, config, 'polish');
  return polished.trim() || cleaned;
}
