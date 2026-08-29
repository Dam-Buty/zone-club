/**
 * Configuration Radarr déclarative et idempotente.
 *
 * Radarr stocke ses réglages dans `radarr-vo-config/radarr.db`, qui est gitignoré :
 * sans ce script, les profils, formats et seuils réglés à la main n'existent que
 * sur cette machine, sans trace ni explication. Une sauvegarde Radarr (zip) permet
 * de restaurer, mais c'est un blob binaire — on ne peut ni le relire, ni le differ,
 * ni y trouver le POURQUOI d'un score. C'est ce que ce fichier apporte.
 *
 * Le script compare l'état réel à l'état voulu et n'écrit que les différences.
 * Relançable sans risque : deux exécutions de suite, la seconde ne fait rien.
 *
 * Usage:
 *   npm run configure:radarr            # applique
 *   npm run configure:radarr -- --dry   # montre les écarts sans rien changer
 *
 * La clé vient de RADARR_API_KEY (jamais en dur — cf. l'ancien init-radarr.sh,
 * qui portait la clé de production dans un dépôt public).
 */

// Ce fichier ne comporte ni import ni export : sans ce marqueur, TypeScript le
// traiterait comme un script GLOBAL, et ses `api`/`main` collisionneraient avec
// celles des autres scripts du dossier.
export {}

const URL_BASE = process.env.RADARR_URL || 'http://radarr:7878'
const API_KEY = process.env.RADARR_API_KEY || ''
const DRY = process.argv.includes('--dry')

if (!API_KEY) {
    console.error('RADARR_API_KEY manquante — lancer via `npm run configure:radarr` (charge .env)')
    process.exit(1)
}

// ─── État voulu ──────────────────────────────────────────────────────────────

// Le dossier racine doit être vu par Radarr AU MÊME CHEMIN que sur l'hôte, et
// partager son point de montage avec le dossier de téléchargement SABnzbd : le
// noyau refuse un lien dur entre deux mounts distincts, donc deux binds Docker
// séparés condamnent Radarr à recopier chaque film au lieu de le lier.
const ROOT_FOLDER = process.env.RADARR_ROOT_FOLDER || '/data/phat-two/zone-club-radarr'

interface FormatSpec {
    name: string
    implementation: 'ReleaseTitleSpecification' | 'ResolutionSpecification'
    value: string | number
}

const CUSTOM_FORMATS: { name: string; why: string; specs: FormatSpec[] }[] = [
    {
        name: 'h264',
        why: 'Le h264 est lu partout ; le HEVC et l\'AV1 obligent notre pipeline à réencoder.',
        specs: [{ name: 'h264', implementation: 'ReleaseTitleSpecification', value: '(x|h)\\.?264' }],
    },
    {
        name: 'MultiAudio',
        why: 'Exigé (score = minimum du profil VO) : sans piste multiple, pas de VF possible.',
        specs: [{ name: 'MULTI', implementation: 'ReleaseTitleSpecification', value: '\\bMULTI\\b' }],
    },
    {
        name: 'FrenchAudio',
        why: 'Exigé sur le profil des films français.',
        specs: [{ name: 'FRENCH', implementation: 'ReleaseTitleSpecification', value: '\\b(TRUE.?FRENCH|FRENCH|MULTI|VFF)\\b' }],
    },
    {
        name: 'Resolution1080p',
        why: 'Sans lui, une release 720p et une 1080p scorent identiquement et rien ne les départage : Radarr gardait le 720p déjà en file.',
        specs: [{ name: '1080p', implementation: 'ResolutionSpecification', value: 1080 }],
    },
    {
        name: 'FrenchAudioExplicit',
        why: 'MULTI ne veut pas dire français : une release polonaise (groupe PSiG) est passée le 23/08 et a dû être rejetée après téléchargement. Ce format fait remonter celles qui annoncent explicitement une VF, sans exclure les MULTi nus.',
        specs: [{ name: 'VF explicite', implementation: 'ReleaseTitleSpecification', value: '\\b(TRUE.?FRENCH|VFF|VF2|VFQ|VFI|FRENCH)\\b' }],
    },
]

interface ProfileSpec {
    name: string
    why: string
    cutoffQuality: string
    upgradeAllowed: boolean
    language: string
    minFormatScore: number
    scores: Record<string, number>   // format non listé = score 0
}

const PROFILES: ProfileSpec[] = [
    {
        name: 'HD-VO (MULTi)',
        why: 'Films non francophones : on veut une release combinée VF+VO.',
        cutoffQuality: 'Bluray-1080p',   // était Bluray-720p : tout 1080p était refusé dès qu'un 720p entrait en file
        upgradeAllowed: true,            // était false : aucun rattrapage possible après un repli en 720p
        language: 'Any',                 // était Original : les MULTi taguées VFF/TRUEFRENCH étaient lues « françaises » et rejetées pour un film anglophone
        minFormatScore: 100,
        scores: { MultiAudio: 100, Resolution1080p: 50, FrenchAudioExplicit: 40, h264: 15 },
    },
    {
        name: 'HD-FR (TrueFrench)',
        why: 'Films francophones : la VO est déjà la VF.',
        cutoffQuality: 'Bluray-1080p',
        upgradeAllowed: true,
        language: 'Any',
        minFormatScore: 100,
        scores: { FrenchAudio: 100, Resolution1080p: 50, FrenchAudioExplicit: 40, h264: 15 },
    },
]

// 80 Mo/min plafonnait un film de 2h45 à ~12,9 Go — or un BluRay 1080p MULTi avec
// pistes DTS pèse 15 à 19 Go, donc TOUS étaient rejetés pour dépassement de taille.
//
// Puis 180 s'est révélé pénaliser les films COURTS : Massacre à la tronçonneuse
// (83 min) a vu sa seule bonne candidate — BluRay 1080p MULTi h264, score 165 —
// refusée pour 1,8 Gio de trop. Un plafond au ratio suppose une densité constante,
// or un remaster granuleux de 1974 tient légitimement 212 Mo/min. Les bonnes
// releases du catalogue s'étalent de 93 à 212 Mo/min ; 250 les couvre toutes.
//
// Puis 150 s'est révélé encore trop juste : sur Interstellar (169 min), la
// meilleure release — seule 1080p MULTi h264, score maximum 205 — pesait très
// exactement le plafond et se faisait refuser sur l'ex æquo, laissant la place à
// une AV1 moins bien notée. 180 laisse une marge (≈29,7 Go pour 169 min).
//
// Contrepartie assumée : des sources plus grosses, donc des backups Hetzner plus
// longs (~10 min pour 26 Go). Le backup tournant en parallèle de l'encodage, ça ne
// rallonge le traitement que s'il dépasse la durée du transcode.
//
// Remux-1080p était plafonné à 80, ce qui l'excluait de fait — un remux pèse
// ~300 Mo/min. Mais certains films n'ont AUCUNE autre release éligible (Naked Gun,
// Massacre à la tronçonneuse) et restaient donc sans média. On le rend atteignable
// à 450 Mo/min, et on le RÉTROGRADE dans l'ordre du profil (voir LAST_RESORT) pour
// qu'il ne serve que de dernier recours au lieu d'être préféré.
const QUALITY_SIZES: Record<string, { preferredSize: number; maxSize: number }> = {
    'HDTV-1080p': { preferredSize: 130, maxSize: 250 },
    'WEBDL-1080p': { preferredSize: 130, maxSize: 250 },
    'WEBRip-1080p': { preferredSize: 130, maxSize: 250 },
    'Bluray-1080p': { preferredSize: 130, maxSize: 250 },
    'Remux-1080p': { preferredSize: 300, maxSize: 450 },
    // Le 2160p est plafonné COMME le 1080p, et non plus haut : l'encodage
    // redimensionne tout en 1080p, donc les octets au-delà de ~250 Mo/min sont
    // jetés au scale et ne coûtent que de la bande passante — laquelle est déjà
    // le goulot (le backup Hetzner tombe à 15 Mo/s quand l'usenet tourne).
    // Ce plafond admet L'Exorciste 2160p MULTi (15,3 Go, 116 Mo/min) et écarte
    // les rips 4K massifs comme le UHD.hdr.hevc du même film (36,9 Go, 280 Mo/min).
    'HDTV-2160p': { preferredSize: 130, maxSize: 250 },
    'WEBDL-2160p': { preferredSize: 130, maxSize: 250 },
    'WEBRip-2160p': { preferredSize: 130, maxSize: 250 },
    'Bluray-2160p': { preferredSize: 130, maxSize: 250 },
}

// Radarr classe les paliers par leur ordre dans `items` : le dernier est préféré.
// Certains paliers doivent rester ATTEIGNABLES sans devenir PRÉFÉRÉS. On les
// regroupe donc juste sous l'ancre, dans l'ordre ci-dessous (du moins au plus
// préféré), pour qu'ils ne servent qu'à défaut de mieux :
//
//   … 720p … │ Remux-1080p │ 2160p… │ HDTV-1080p │ WEB-1080p │ Bluray-1080p
//                                    └── ancre, tout ce qui suit passe devant
//
// Sans ce classement, les deux tolérances se retourneraient contre nous : relever
// la taille du remux suffisait à le faire choisir (26 Go retenus contre 4 Go), et
// le 2160p figure nativement AU-DESSUS de tout le 1080p (rangs 20-23 contre 19),
// donc l'autoriser le rendrait prioritaire d'office.
const LAST_RESORT_ANCHOR = 'HDTV-1080p'
const LAST_RESORT = ['Remux-1080p', 'HDTV-2160p', 'WEB 2160p', 'Bluray-2160p']

// Paliers dont il faut forcer l'autorisation. Radarr répond « is not wanted in
// profile » AVANT de regarder la taille, donc un plafond ne suffit pas à tolérer
// le 2160p : il faut aussi cocher le palier.
//
// Motif : certains films n'ont aucune release 1080p multi-audio. Sur L'Exorciste,
// les 12 meilleures 1080p plafonnent à 65 (h264 + Resolution1080p, sans MULTi) et
// tombent sous le minFormatScore ; la seule VF+VO du lot est une 2160p à 140.
// Remux-2160p reste volontairement interdit : à ~1 Go/min il ne passerait jamais
// le plafond, autant ne pas l'offrir.
const ALLOWED = ['HDTV-2160p', 'WEB 2160p', 'Bluray-2160p']

// ─── Application ─────────────────────────────────────────────────────────────

const changes: string[] = []

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${URL_BASE}/api/v3${path}`, {
        ...init,
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json', ...init.headers },
        signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
}

function note(msg: string): void {
    changes.push(msg)
    console.log(`  ${DRY ? '[dry] ' : ''}${msg}`)
}

/** Sous-ensembles de l'API Radarr v3 effectivement manipulés par ce script. */
interface RadarrCustomFormat {
    id: number
    name: string
    specifications?: { fields?: { name: string; value: unknown }[] }[]
}

/** Un palier de qualité, ou un groupe qui en contient (« WEB 2160p »). */
interface RadarrQualityItem {
    name?: string
    allowed: boolean
    quality?: { id: number; name: string }
    items?: RadarrQualityItem[]
}

interface RadarrProfile {
    id: number
    name: string
    cutoff: number
    upgradeAllowed: boolean
    minFormatScore: number
    language?: { id: number; name: string }
    items: RadarrQualityItem[]
    formatItems: { name: string; score: number }[]
}

interface RadarrQualityDefinition {
    title: string
    maxSize: number
    preferredSize: number
}

async function ensureCustomFormats(): Promise<void> {
    const existing = await api<RadarrCustomFormat[]>('/customformat')
    for (const want of CUSTOM_FORMATS) {
        const found = existing.find(f => f.name === want.name)
        const specs = want.specs.map(s => ({
            name: s.name,
            implementation: s.implementation,
            negate: false,
            required: true,
            fields: [{ name: 'value', value: s.value }],
        }))
        if (!found) {
            note(`format "${want.name}" créé`)
            if (!DRY) await api('/customformat', { method: 'POST', body: JSON.stringify({ name: want.name, includeCustomFormatWhenRenaming: false, specifications: specs }) })
            continue
        }
        const actual = found.specifications?.[0]?.fields?.find(f => f.name === 'value')?.value
        if (String(actual) !== String(want.specs[0].value)) {
            note(`format "${want.name}" : regex ${JSON.stringify(actual)} → ${JSON.stringify(want.specs[0].value)}`)
            if (!DRY) await api(`/customformat/${found.id}`, { method: 'PUT', body: JSON.stringify({ ...found, specifications: specs }) })
        }
    }
}

async function ensureProfiles(): Promise<void> {
    const profiles = await api<RadarrProfile[]>('/qualityprofile')
    for (const want of PROFILES) {
        const p = profiles.find(x => x.name === want.name)
        if (!p) { console.warn(`  ⚠️  profil "${want.name}" absent — à créer à la main (les paliers de qualité ne sont pas décrits ici)`); continue }

        const flat = p.items
            .flatMap(it => (it.quality ? [it] : it.items ?? []))
            .filter((it): it is RadarrQualityItem & { quality: { id: number; name: string } } => !!it.quality)
        const cutoff = flat.find(x => x.quality.name === want.cutoffQuality)
        if (!cutoff) { console.warn(`  ⚠️  "${want.cutoffQuality}" introuvable dans "${want.name}"`); continue }

        let dirty = false
        if (p.cutoff !== cutoff.quality.id) { note(`profil "${want.name}" : cutoff → ${want.cutoffQuality}`); p.cutoff = cutoff.quality.id; dirty = true }
        if (p.upgradeAllowed !== want.upgradeAllowed) { note(`profil "${want.name}" : upgradeAllowed → ${want.upgradeAllowed}`); p.upgradeAllowed = want.upgradeAllowed; dirty = true }
        if (p.language?.name !== want.language) { note(`profil "${want.name}" : langue ${p.language?.name} → ${want.language}`); p.language = { id: -1, name: 'Any' }; dirty = true }
        if (p.minFormatScore !== want.minFormatScore) { note(`profil "${want.name}" : minFormatScore → ${want.minFormatScore}`); p.minFormatScore = want.minFormatScore; dirty = true }

        const idxOf = (name: string) => p.items.findIndex(it =>
            it.quality ? it.quality.name === name : it.name === name)
        const nameAt = (i: number) => {
            const it = p.items[i]
            return it ? (it.quality ? it.quality.name : it.name) : ''
        }

        // Autorisation des paliers tolérés.
        for (const name of ALLOWED) {
            const it = p.items[idxOf(name)]
            if (!it || it.allowed) continue
            note(`profil "${want.name}" : palier ${name} autorisé`)
            it.allowed = true
            // Un groupe (« WEB 2160p ») n'ouvre pas ses membres en s'ouvrant :
            // WEBDL-2160p et WEBRip-2160p resteraient refusés individuellement.
            if (it.items) for (const sub of it.items) sub.allowed = true
            dirty = true
        }

        // Regroupement du bloc « dernier recours » juste sous l'ancre.
        // L'idempotence se vérifie sur la disposition RÉELLE — les noms qui
        // précèdent l'ancre — et non sur des indices : comparer `from !== target`
        // laissait les deux indices différents après déplacement, donc le script
        // « corrigeait » à chaque appel.
        const present = LAST_RESORT.filter(n => idxOf(n) >= 0)
        const anchor = idxOf(LAST_RESORT_ANCHOR)
        const already = anchor >= present.length
            && present.every((n, k) => nameAt(anchor - present.length + k) === n)
        if (anchor >= 0 && present.length > 0 && !already) {
            note(`profil "${want.name}" : ${present.join(', ')} regroupés sous ${LAST_RESORT_ANCHOR} (dernier recours)`)
            const moved = present.map(n => p.items.splice(idxOf(n), 1)[0])
            p.items.splice(idxOf(LAST_RESORT_ANCHOR), 0, ...moved)
            dirty = true
        }

        for (const item of p.formatItems) {
            const target = want.scores[item.name] ?? 0
            if (item.score !== target) { note(`profil "${want.name}" : score ${item.name} ${item.score} → ${target}`); item.score = target; dirty = true }
        }
        if (dirty && !DRY) await api(`/qualityprofile/${p.id}`, { method: 'PUT', body: JSON.stringify(p) })
    }
}

async function ensureQualitySizes(): Promise<void> {
    const defs = await api<RadarrQualityDefinition[]>('/qualitydefinition')
    const todo = defs.filter(d => QUALITY_SIZES[d.title] &&
        (d.maxSize !== QUALITY_SIZES[d.title].maxSize || d.preferredSize !== QUALITY_SIZES[d.title].preferredSize))
    if (todo.length === 0) return
    for (const d of todo) note(`taille "${d.title}" : max ${d.maxSize} → ${QUALITY_SIZES[d.title].maxSize} Mo/min`)
    if (!DRY) {
        const payload = todo.map(d => ({ ...d, ...QUALITY_SIZES[d.title] }))
        await api('/qualitydefinition/update', { method: 'PUT', body: JSON.stringify(payload) })
    }
}

async function ensureRootFolder(): Promise<void> {
    const folders = await api<{ path: string }[]>('/rootfolder')
    if (folders.some(f => f.path === ROOT_FOLDER)) return
    note(`dossier racine "${ROOT_FOLDER}" ajouté`)
    if (!DRY) await api('/rootfolder', { method: 'POST', body: JSON.stringify({ path: ROOT_FOLDER }) })
}

async function checkRemotePathMappings(): Promise<void> {
    const maps = await api<{ host: string; remotePath: string; localPath: string }[]>('/remotepathmapping')
    if (maps.length > 0) {
        console.warn(`  ⚠️  ${maps.length} remote path mapping(s) présent(s) : inutiles quand Radarr voit les mêmes chemins que l'hôte, et nuisibles s'ils pointent vers d'anciens chemins.`)
        for (const m of maps) console.warn(`      ${m.host}: ${m.remotePath} → ${m.localPath}`)
    }
}

async function main(): Promise<void> {
    console.log(`Radarr ${URL_BASE}${DRY ? '  (simulation)' : ''}`)
    await ensureCustomFormats()
    await ensureProfiles()
    await ensureQualitySizes()
    await ensureRootFolder()
    await checkRemotePathMappings()
    console.log(changes.length === 0 ? '\n✓ configuration déjà conforme' : `\n${changes.length} changement(s)${DRY ? ' à appliquer' : ' appliqué(s)'}`)
}

main().catch(err => { console.error('Erreur :', err instanceof Error ? err.message : String(err)); process.exit(1) })
