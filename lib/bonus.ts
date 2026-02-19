import { db } from './db';

export function getISOWeek(): string {
    const now = new Date();
    // ISO 8601 week number calculation
    const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
    const daysSinceJan4 = Math.floor((now.getTime() - jan4.getTime()) / 86400000);
    const weekNumber = Math.ceil((daysSinceJan4 + jan4.getUTCDay() + 1) / 7);
    return `${now.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

export function canClaimWeeklyBonus(userId: number): { canClaim: boolean; amount: number; reason?: string } {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number } | undefined;
    if (!user) return { canClaim: false, amount: 0, reason: 'Utilisateur non trouvé' };

    if (user.credits >= 5) {
        return { canClaim: false, amount: 0, reason: 'Solde >= 5 crédits' };
    }

    const week = getISOWeek();
    const existing = db.prepare(
        'SELECT 1 FROM weekly_bonuses WHERE user_id = ? AND week_number = ?'
    ).get(userId, week);

    if (existing) {
        return { canClaim: false, amount: 0, reason: 'Bonus déjà réclamé cette semaine' };
    }

    const amount = Math.min(3, 5 - user.credits);
    return { canClaim: true, amount };
}

export function claimWeeklyBonus(userId: number): { credits_awarded: number; new_balance: number } {
    const check = canClaimWeeklyBonus(userId);
    if (!check.canClaim) throw new Error(check.reason!);

    const week = getISOWeek();

    db.transaction(() => {
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(check.amount, userId);
        db.prepare('INSERT INTO weekly_bonuses (user_id, credits_awarded, week_number) VALUES (?, ?, ?)')
            .run(userId, check.amount, week);
    })();

    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    return { credits_awarded: check.amount, new_balance: user.credits };
}
