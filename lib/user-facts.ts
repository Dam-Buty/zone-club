import { db } from './db';

interface UserFact {
  id: number;
  user_id: number;
  fact: string;
  created_at: string;
}

export function addUserFact(userId: number, fact: string): void {
  db.prepare(
    'INSERT INTO user_facts (user_id, fact) VALUES (?, ?)'
  ).run(userId, fact);
}

export function getUserFacts(userId: number): UserFact[] {
  return db.prepare(
    'SELECT * FROM user_facts WHERE user_id = ? ORDER BY created_at ASC'
  ).all(userId) as UserFact[];
}
