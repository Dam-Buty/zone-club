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
// Remux-1080p reste volontairement à 80 : un remux (~300 Mo/min) dépasse toujours,
// ce qui l'exclut de fait sans avoir à le retirer du profil.
const QUALITY_SIZES: Record<string, { preferredSize: number; maxSize: number }> = {
    'HDTV-1080p': { preferredSize: 110, maxSize: 150 },
    'WEBDL-1080p': { preferredSize: 110, maxSize: 150 },
    'WEBRip-1080p': { preferredSize: 110, maxSize: 150 },
    'Bluray-1080p': { preferredSize: 110, maxSize: 150 },
}

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

async function ensureCustomFormats(): Promise<void> {
    const existing = await api<any[]>('/customformat')
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
        const actual = found.specifications?.[0]?.fields?.find((f: any) => f.name === 'value')?.value
        if (String(actual) !== String(want.specs[0].value)) {
            note(`format "${want.name}" : regex ${JSON.stringify(actual)} → ${JSON.stringify(want.specs[0].value)}`)
            if (!DRY) await api(`/customformat/${found.id}`, { method: 'PUT', body: JSON.stringify({ ...found, specifications: specs }) })
        }
    }
}

async function ensureProfiles(): Promise<void> {
    const profiles = await api<any[]>('/qualityprofile')
    for (const want of PROFILES) {
        const p = profiles.find(x => x.name === want.name)
        if (!p) { console.warn(`  ⚠️  profil "${want.name}" absent — à créer à la main (les paliers de qualité ne sont pas décrits ici)`); continue }

        const flat = p.items.flatMap((it: any) => (it.quality ? [it] : it.items))
        const cutoff = flat.find((x: any) => x.quality.name === want.cutoffQuality)
        if (!cutoff) { console.warn(`  ⚠️  "${want.cutoffQuality}" introuvable dans "${want.name}"`); continue }

        let dirty = false
        if (p.cutoff !== cutoff.quality.id) { note(`profil "${want.name}" : cutoff → ${want.cutoffQuality}`); p.cutoff = cutoff.quality.id; dirty = true }
        if (p.upgradeAllowed !== want.upgradeAllowed) { note(`profil "${want.name}" : upgradeAllowed → ${want.upgradeAllowed}`); p.upgradeAllowed = want.upgradeAllowed; dirty = true }
        if (p.language?.name !== want.language) { note(`profil "${want.name}" : langue ${p.language?.name} → ${want.language}`); p.language = { id: -1, name: 'Any' }; dirty = true }
        if (p.minFormatScore !== want.minFormatScore) { note(`profil "${want.name}" : minFormatScore → ${want.minFormatScore}`); p.minFormatScore = want.minFormatScore; dirty = true }

        for (const item of p.formatItems) {
            const target = want.scores[item.name] ?? 0
            if (item.score !== target) { note(`profil "${want.name}" : score ${item.name} ${item.score} → ${target}`); item.score = target; dirty = true }
        }
        if (dirty && !DRY) await api(`/qualityprofile/${p.id}`, { method: 'PUT', body: JSON.stringify(p) })
    }
}

async function ensureQualitySizes(): Promise<void> {
    const defs = await api<any[]>('/qualitydefinition')
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
    const folders = await api<any[]>('/rootfolder')
    if (folders.some(f => f.path === ROOT_FOLDER)) return
    note(`dossier racine "${ROOT_FOLDER}" ajouté`)
    if (!DRY) await api('/rootfolder', { method: 'POST', body: JSON.stringify({ path: ROOT_FOLDER }) })
}

async function checkRemotePathMappings(): Promise<void> {
    const maps = await api<any[]>('/remotepathmapping')
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
