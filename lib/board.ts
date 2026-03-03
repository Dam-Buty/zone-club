import { db } from './db';

const MAX_CONTENT = 288;
const GRID_ROWS = 6;
const GRID_COLS = 8;
const VALID_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;

export type NoteColor = typeof VALID_COLORS[number];

export interface BoardNote {
    id: number;
    user_id: number;
    content: string;
    color: NoteColor;
    grid_row: number;
    grid_col: number;
    created_at: string;
}

export interface BoardNoteWithUser extends BoardNote {
    username: string;
}

export function getAllNotes(): BoardNoteWithUser[] {
    return db.prepare(`
        SELECT bn.*, u.username
        FROM board_notes bn
        JOIN users u ON bn.user_id = u.id
        ORDER BY bn.created_at DESC
    `).all() as BoardNoteWithUser[];
}

export function createNote(
    userId: number,
    content: string,
    color: string,
    preferredRow?: number,
    preferredCol?: number,
): BoardNoteWithUser {
    const trimmed = content.trim();
    if (!trimmed) {
        throw new Error('Le contenu ne peut pas être vide');
    }
    if (trimmed.length > MAX_CONTENT) {
        throw new Error(`Le contenu ne peut pas dépasser ${MAX_CONTENT} caractères`);
    }
    if (!VALID_COLORS.includes(color as NoteColor)) {
        throw new Error('Couleur invalide');
    }

    const occupied = db.prepare(
        'SELECT grid_row, grid_col FROM board_notes'
    ).all() as { grid_row: number; grid_col: number }[];

    const occupiedSet = new Set(occupied.map(o => `${o.grid_row}-${o.grid_col}`));

    let freeRow = -1;
    let freeCol = -1;

    // Use preferred position if provided and free
    if (
        preferredRow !== undefined && preferredCol !== undefined &&
        preferredRow >= 0 && preferredRow < GRID_ROWS &&
        preferredCol >= 0 && preferredCol < GRID_COLS &&
        !occupiedSet.has(`${preferredRow}-${preferredCol}`)
    ) {
        freeRow = preferredRow;
        freeCol = preferredCol;
    } else {
        // Fallback: first free cell (row-major order)
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                if (!occupiedSet.has(`${r}-${c}`)) {
                    freeRow = r;
                    freeCol = c;
                    break;
                }
            }
            if (freeRow >= 0) break;
        }
    }

    if (freeRow < 0) {
        throw new Error('Le tableau est plein');
    }

    const result = db.prepare(`
        INSERT INTO board_notes (user_id, content, color, grid_row, grid_col)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, trimmed, color, freeRow, freeCol);

    return db.prepare(`
        SELECT bn.*, u.username
        FROM board_notes bn
        JOIN users u ON bn.user_id = u.id
        WHERE bn.id = ?
    `).get(result.lastInsertRowid) as BoardNoteWithUser;
}

export function deleteNote(noteId: number, userId: number, isAdmin: boolean): void {
    const note = db.prepare('SELECT * FROM board_notes WHERE id = ?').get(noteId) as BoardNote | undefined;
    if (!note) {
        throw new Error('Note introuvable');
    }
    if (note.user_id !== userId && !isAdmin) {
        throw new Error('Non autorisé');
    }
    db.prepare('DELETE FROM board_notes WHERE id = ?').run(noteId);
}

export function getBoardCapacity(): { total: number; used: number } {
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM board_notes').get() as { cnt: number };
    return { total: GRID_ROWS * GRID_COLS, used: cnt };
}
