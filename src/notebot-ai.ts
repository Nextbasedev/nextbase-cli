import type { Config } from './config.js';
import type { MeetingNote, MeetingTask } from './notebot-storage.js';

function stripFences(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function safeTasks(value: unknown): MeetingTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === 'object')
    .map((task) => ({
      task: typeof task.task === 'string' ? task.task.trim() : '',
      owner: typeof task.owner === 'string' && task.owner.trim() ? task.owner.trim() : undefined,
      dueDate: typeof task.dueDate === 'string' && task.dueDate.trim() ? task.dueDate.trim() : undefined,
      confidence: (task.confidence === 'explicit' || task.confidence === 'suggested' ? task.confidence : 'unassigned') as MeetingTask['confidence']
    }))
    .filter((task) => task.task);
}

export async function analyzeMeeting(transcript: string, config: Config): Promise<Pick<MeetingNote, 'title' | 'summary' | 'decisions' | 'actionItems' | 'blockers' | 'openQuestions' | 'language'>> {
  const key = config.keys?.groq;
  if (!key) throw new Error('NoteBot needs a Groq API key for meeting summary. Run: notebot setup');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.polishModel || 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract structured meeting notes from multilingual Gujarati, Hindi, English, Hinglish, and mixed-language transcripts. Return valid JSON only. Never invent facts, decisions, people, deadlines, or responsibilities. Only set actionItems[].owner when explicitly assigned in the transcript. If project context suggests someone but they were not assigned, set confidence to "suggested". Otherwise omit owner and set confidence to "unassigned". Keep the original transcript language out of the output; write title and summary in English.`
        },
        {
          role: 'user',
          content: `Transcript:\n${transcript}\n\nReturn exactly this JSON shape:\n{"title":"string","summary":"string","decisions":["string"],"actionItems":[{"task":"string","owner":"optional string","dueDate":"optional string","confidence":"explicit|suggested|unassigned"}],"blockers":["string"],"openQuestions":["string"],"language":"string"}`
        }
      ]
    })
  });

  const body = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Meeting analysis failed: HTTP ${response.status}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(body.choices?.[0]?.message?.content || '')) as Record<string, unknown>;
  } catch {
    throw new Error('Meeting analysis returned invalid structured data.');
  }

  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled meeting',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    decisions: strings(parsed.decisions),
    actionItems: safeTasks(parsed.actionItems),
    blockers: strings(parsed.blockers),
    openQuestions: strings(parsed.openQuestions),
    language: typeof parsed.language === 'string' ? parsed.language.trim() : 'mixed'
  };
}
