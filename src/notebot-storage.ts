import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MeetingTask = {
  task: string;
  owner?: string;
  dueDate?: string;
  confidence: 'explicit' | 'suggested' | 'unassigned';
};

export type MeetingNote = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  audioPath: string;
  transcript: string;
  summary: string;
  decisions: string[];
  actionItems: MeetingTask[];
  blockers: string[];
  openQuestions: string[];
  language: string;
};

export type ActiveMeeting = {
  id: string;
  startedAt: number;
  pid?: number;
  audioPath?: string;
  status: 'starting' | 'recording' | 'recorded';
};

const dir = join(homedir(), '.notebot');
const notesFile = join(dir, 'meetings.json');
const activeFile = join(dir, 'active-meeting.json');

async function writeJson(path: string, value: unknown) {
  await mkdir(dir, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
}

export async function loadMeetings(): Promise<MeetingNote[]> {
  try {
    return JSON.parse(await readFile(notesFile, 'utf8')) as MeetingNote[];
  } catch {
    return [];
  }
}

export async function saveMeeting(note: MeetingNote) {
  const notes = await loadMeetings();
  notes.unshift(note);
  await writeJson(notesFile, notes);
}

export async function loadActiveMeeting(): Promise<ActiveMeeting | undefined> {
  try {
    return (JSON.parse(await readFile(activeFile, 'utf8')) as ActiveMeeting | null) || undefined;
  } catch {
    return undefined;
  }
}

export async function saveActiveMeeting(meeting: ActiveMeeting) {
  await writeJson(activeFile, meeting);
}

export async function clearActiveMeeting() {
  await writeJson(activeFile, null);
}
