import { db } from './db';

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatSession {
  id: number;
  user_id: number;
  raw_messages: string;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
}

export function createSession(userId: number): number {
  const result = db.prepare(
    'INSERT INTO chat_sessions (user_id) VALUES (?)'
  ).run(userId);
  return result.lastInsertRowid as number;
}

export function appendMessages(sessionId: number, messages: ChatMessage[]): void {
  db.transaction(() => {
    const session = db.prepare(
      'SELECT raw_messages FROM chat_sessions WHERE id = ?'
    ).get(sessionId) as { raw_messages: string } | undefined;

    if (!session) return;

    const existing: ChatMessage[] = JSON.parse(session.raw_messages);
    existing.push(...messages);

    db.prepare(
      'UPDATE chat_sessions SET raw_messages = ? WHERE id = ?'
    ).run(JSON.stringify(existing), sessionId);
  })();
}

export function closeSession(sessionId: number, summary: string): void {
  db.prepare(
    "UPDATE chat_sessions SET summary = ?, ended_at = datetime('now') WHERE id = ?"
  ).run(summary, sessionId);
}

export function getRecentSummaries(userId: number, limit = 5): { summary: string; started_at: string }[] {
  return db.prepare(
    'SELECT summary, started_at FROM chat_sessions WHERE user_id = ? AND summary IS NOT NULL ORDER BY started_at DESC LIMIT ?'
  ).all(userId, limit) as { summary: string; started_at: string }[];
}

export function getCurrentSession(userId: number): ChatSession | null {
  return db.prepare(
    'SELECT * FROM chat_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
  ).get(userId) as ChatSession | null;
}
