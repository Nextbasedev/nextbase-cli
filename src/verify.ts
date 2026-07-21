import type { Provider } from './config.js';

export type VerifyResult = {
  ok: boolean;
  message: string;
};

export async function verifyProviderKey(provider: Provider, key: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'No key entered, skipped verification.' };

  try {
    if (provider === 'groq') {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { authorization: `Bearer ${key}` }
      });
      return response.ok
        ? { ok: true, message: 'Groq key verified.' }
        : { ok: false, message: `Groq verification failed: HTTP ${response.status}` };
    }

    if (provider === 'elevenlabs') {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key }
      });
      return response.ok
        ? { ok: true, message: 'ElevenLabs key verified.' }
        : { ok: false, message: `ElevenLabs verification failed: HTTP ${response.status}` };
    }

    if (provider === 'sarvam') {
      // Sarvam does not expose the same lightweight `/models`/`/user` style
      // verification endpoint used by Groq/ElevenLabs. The previous verifier
      // called `/models`, which returns 404 even for valid keys and blocked
      // setup. Accept a non-empty key here; the first transcription request to
      // `/speech-to-text` performs the real API validation.
      return { ok: true, message: 'Sarvam key saved. It will be validated on first transcription.' };
    }
  } catch (error) {
    return { ok: false, message: `Verification error: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { ok: false, message: `Verification not implemented for ${provider}.` };
}
