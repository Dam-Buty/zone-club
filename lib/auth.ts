import bcrypt from 'bcrypt';
import { db } from './db';
import { generatePassphrase } from './passphrase';

const SALT_ROUNDS = 12;

export interface User {
    id: number;
    username: string;
    credits: number;
    is_admin: boolean;
    created_at: string;
}

export interface RegisterResult {
    user: User;
    recoveryPhrase: string;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export async function registerUser(username: string, password: string): Promise<RegisterResult> {
    const passwordHash = await hashPassword(password);
    const recoveryPhrase = generatePassphrase();
    const recoveryPhraseHash = await hashPassword(recoveryPhrase);

    const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, recovery_phrase_hash)
        VALUES (?, ?, ?)
    `);

    const result = stmt.run(username, passwordHash, recoveryPhraseHash);

    const user = db.prepare('SELECT id, username, credits, is_admin, created_at FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as User;

    return { user, recoveryPhrase };
}

export async function loginUser(username: string, password: string): Promise<User | null> {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!row) return null;

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) return null;

    return {
        id: row.id,
        username: row.username,
        credits: row.credits,
        is_admin: row.is_admin,
        created_at: row.created_at
    };
}

export async function recoverAccount(username: string, recoveryPhrase: string, newPassword: string): Promise<{ user: User; newRecoveryPhrase: string } | null> {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!row) return null;

    const valid = await verifyPassword(recoveryPhrase, row.recovery_phrase_hash);
    if (!valid) return null;

    const newPasswordHash = await hashPassword(newPassword);
    const newRecoveryPhrase = generatePassphrase();
    const newRecoveryPhraseHash = await hashPassword(newRecoveryPhrase);

    db.prepare(`
        UPDATE users
        SET password_hash = ?, recovery_phrase_hash = ?
        WHERE id = ?
    `).run(newPasswordHash, newRecoveryPhraseHash, row.id);

    return {
        user: {
            id: row.id,
            username: row.username,
            credits: row.credits,
            is_admin: row.is_admin,
            created_at: row.created_at
        },
        newRecoveryPhrase
    };
}

export function getUserById(id: number): User | null {
    const row = db.prepare('SELECT id, username, credits, is_admin, created_at FROM users WHERE id = ?')
        .get(id) as User | undefined;
    return row || null;
}

export function usernameExists(username: string): boolean {
    const row = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    return !!row;
}
