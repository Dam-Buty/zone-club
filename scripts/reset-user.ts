/**
 * Régénère la passphrase de récupération d'un compte, et optionnellement son mot de passe.
 *
 * Pourquoi ce script : la passphrase est stockée en bcrypt (`users.recovery_phrase_hash`)
 * et n'existe en clair nulle part — elle n'est affichée qu'une fois, à l'inscription puis
 * à chaque récupération. Si l'utilisateur la perd, elle n'est PAS récupérable : l'espace
 * de recherche est de ~1,7·10¹¹ combinaisons avec un hash à 0,25 s, et `/api/auth/recover`
 * exige justement l'ancienne passphrase. La seule issue est de la REMPLACER en base.
 *
 * La nouvelle phrase est générée par `lib/passphrase.ts` (mêmes dictionnaires, même ordre
 * que la production) et hachée par `lib/auth.ts` (même coût bcrypt) : le résultat est
 * indiscernable d'une phrase légitime. Le mot de passe n'est touché que sur demande
 * explicite — un utilisateur qui a perdu sa passphrase a le plus souvent encore son
 * mot de passe.
 *
 * Usage:
 *   npx tsx scripts/reset-user.ts Kaiju
 *   npx tsx scripts/reset-user.ts Kaiju --password            # + mot de passe temporaire généré
 *   npx tsx scripts/reset-user.ts Kaiju --password=temp1234   # + mot de passe imposé
 *   npx tsx scripts/reset-user.ts Kaiju --dry                 # résout le compte, n'écrit rien
 */

import { randomInt } from 'crypto';
import { db } from '../lib/db';
import { generatePassphrase } from '../lib/passphrase';
import { hashPassword } from '../lib/auth';

interface UserRow {
    id: number;
    username: string;
    credits: number;
    is_admin: number;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPassword(length = 16): string {
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
    return out;
}

function parseArgs(argv: string[]) {
    const positional: string[] = [];
    let password: string | null = null;
    let dry = false;

    for (const arg of argv) {
        if (arg === '--dry') dry = true;
        else if (arg === '--password') password = randomPassword();
        else if (arg.startsWith('--password=')) password = arg.slice('--password='.length);
        else if (arg.startsWith('-')) throw new Error(`Option inconnue : ${arg}`);
        else positional.push(arg);
    }

    return { username: positional[0] ?? null, password, dry };
}

/**
 * Résolution insensible à la casse, mais REFUSE l'ambiguïté : la base contient des
 * paires comme `Saam2406` / `saam2406`, et prendre la première ligne trouvée
 * régénérerait la passphrase du mauvais compte — sans aucun signe visible.
 */
function resolveUser(username: string): UserRow {
    const rows = db.prepare(`
        SELECT id, username, credits, is_admin
        FROM users
        WHERE username = ? COLLATE NOCASE
        ORDER BY id
    `).all(username) as UserRow[];

    if (rows.length === 0) {
        const all = (db.prepare('SELECT username FROM users ORDER BY id').all() as { username: string }[])
            .map(u => u.username);
        throw new Error(`Aucun compte "${username}". Comptes existants : ${all.join(', ')}`);
    }

    if (rows.length > 1) {
        // Une correspondance à la casse EXACTE lève l'ambiguïté : `saam2406` désigne
        // sans doute possible le compte #20, tandis que `Saam2406` désigne le #19.
        const exact = rows.filter(u => u.username === username);
        if (exact.length === 1) {
            console.log(`Note    : "${username}" correspond à ${exact.length} compte(s) à la casse exacte (#${exact[0].id}).`);
            return exact[0];
        }
        const detail = rows.map(u => `#${u.id} "${u.username}"`).join(', ');
        throw new Error(`"${username}" est ambigu (${detail}) — relancer avec le pseudo exact.`);
    }

    return rows[0];
}

async function main(): Promise<void> {
    const { username, password, dry } = parseArgs(process.argv.slice(2));

    if (!username) {
        console.error('Usage : npx tsx scripts/reset-user.ts <pseudo> [--password[=valeur]] [--dry]');
        process.exit(1);
    }

    if (password !== null && password.length < 8) {
        console.error('Le mot de passe doit faire au moins 8 caractères (règle de /api/auth/recover).');
        process.exit(1);
    }

    const user = resolveUser(username);
    const label = `#${user.id} "${user.username}" (${user.credits} crédits${user.is_admin ? ', admin' : ''})`;
    console.log(`Compte  : ${label}`);
    console.log(`Base    : ${process.env.DATABASE_PATH || './zone.db'}`);

    if (dry) {
        console.log('Mode --dry : aucune écriture. La passphrase serait régénérée' + (password !== null ? ' et le mot de passe remplacé.' : '.'));
        return;
    }

    // Génération puis auto-vérification AVANT écriture : si le hash produit ne relit pas
    // la phrase, on préfère échouer bruyamment que laisser un compte inaccessible.
    const recoveryPhrase = generatePassphrase();
    const recoveryHash = await hashPassword(recoveryPhrase);
    if (!recoveryHash.startsWith('$2')) throw new Error(`Hash inattendu : ${recoveryHash.slice(0, 4)}…`);

    const passwordHash = password !== null ? await hashPassword(password) : null;

    const apply = db.transaction(() => {
        const result = passwordHash
            ? db.prepare('UPDATE users SET recovery_phrase_hash = ?, password_hash = ? WHERE id = ? AND username = ?')
                .run(recoveryHash, passwordHash, user.id, user.username)
            : db.prepare('UPDATE users SET recovery_phrase_hash = ? WHERE id = ? AND username = ?')
                .run(recoveryHash, user.id, user.username);
        if (result.changes !== 1) throw new Error(`${result.changes} ligne(s) modifiée(s) au lieu de 1 — abandon.`);
    });

    apply();

    console.log('');
    console.log(`Nouvelle passphrase : ${recoveryPhrase}`);
    if (password !== null) console.log(`Nouveau mot de passe : ${password}`);
    console.log('');
    console.log('À transmettre une seule fois. Elle n\'est plus lisible ensuite (bcrypt),');
    console.log('et l\'ancienne est définitivement invalide.');
}

main().catch(err => {
    console.error('Erreur :', err instanceof Error ? err.message : err);
    process.exit(1);
});
