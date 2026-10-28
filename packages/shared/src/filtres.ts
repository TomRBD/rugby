// Filtres d'événements (playlists par filtre, recherche en langage naturel, saisie vocale).
import type { Camp, DefinitionTypeEvenement, Evenement, ReperesHorloge } from './types.js';
import { estSucces, indexTypes } from './taxonomie.js';
import { horlogeDepuisVideo } from './horloge.js';
import { zoneDepuisCoordonnees } from './terrain.js';

export interface FiltreEvenements {
  types?: string[];
  camp?: Camp;
  joueurs?: string[];
  numeros?: number[];
  resultats?: string[];
  succes?: boolean;
  miTemps?: 1 | 2;
  zonesLongueur?: number[];
  attributs?: Record<string, string>;
}

export function appliquerFiltre(
  evs: Evenement[],
  f: FiltreEvenements,
  types: DefinitionTypeEvenement[],
  reperes?: ReperesHorloge,
): Evenement[] {
  const idx = indexTypes(types);
  return evs.filter((e) => {
    if (f.types?.length && !f.types.includes(e.typeKey)) return false;
    if (f.camp && e.camp !== f.camp) return false;
    if (f.joueurs?.length) {
      const impliques = [...e.joueurs, ...Object.values(e.attributs ?? {}).filter((x) => typeof x === 'string')];
      if (!f.joueurs.some((j) => impliques.includes(j))) return false;
    }
    if (f.numeros?.length && (e.numeroAdverse == null || !f.numeros.includes(e.numeroAdverse))) return false;
    if (f.resultats?.length && !f.resultats.includes(e.resultat ?? '')) return false;
    if (f.succes !== undefined && estSucces(idx.get(e.typeKey), e.resultat) !== f.succes) return false;
    if (f.miTemps) {
      const h = reperes ? horlogeDepuisVideo(e.debut, reperes) : null;
      if (!h || h.miTemps !== f.miTemps) return false;
    }
    if (f.zonesLongueur?.length) {
      if (e.x == null || e.y == null) return false;
      if (!f.zonesLongueur.includes(zoneDepuisCoordonnees(e.x, e.y).longueur)) return false;
    }
    if (f.attributs) {
      for (const [k, val] of Object.entries(f.attributs)) if (String(e.attributs?.[k] ?? '') !== val) return false;
    }
    return true;
  });
}

export function normaliser(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9: ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const NOMBRES: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, 'dix sept': 17, 'dix huit': 18, 'dix neuf': 19, vingt: 20,
  'vingt et un': 21, 'vingt deux': 22, 'vingt trois': 23,
};

function extraireNombre(texte: string): { nombre: number | null; reste: string } {
  const chiffre = texte.match(/(?:^| )(?:numero |n )?(\d{1,2})(?: |$)/);
  if (chiffre) return { nombre: Number(chiffre[1]), reste: texte.replace(chiffre[0], ' ').trim() };
  const cles = Object.keys(NOMBRES).sort((a, b) => b.length - a.length);
  for (const k of cles) {
    const re = new RegExp(`(?:^| )${k}(?: |$)`);
    if (re.test(texte)) return { nombre: NOMBRES[k], reste: texte.replace(re, ' ').trim() };
  }
  return { nombre: null, reste: texte };
}

function synonymesType(t: DefinitionTypeEvenement): string[] {
  const base = [normaliser(t.label), normaliser(t.key.replace(/_/g, ' '))];
  const extra: Record<string, string[]> = {
    penalite_tentee: ['penalite tentee', 'tir', 'but', 'penalite au pied'],
    penalite: ['penalite concedee', 'faute', 'penalite contre nous'],
    jeu_au_pied: ['coup de pied', 'jeu au pied', 'pied'],
    turnover: ['turnover', 'grattage', 'interception', 'ballon recupere'],
    plaquage: ['plaquage', 'placage', 'plaquages', 'placages'],
    essai: ['essai', 'essais'],
    touche: ['touche', 'touches', 'alignement'],
    melee: ['melee', 'melees'],
    ruck: ['ruck', 'rucks', 'regroupement'],
    renvoi: ['renvoi', 'coup d envoi', 'renvois'],
    entree_22: ['entree dans les 22', 'entrees dans les 22', 'entree 22'],
    franchissement: ['franchissement', 'franchissements', 'percee'],
    transformation: ['transformation', 'transfo', 'transformations'],
    carton: ['carton', 'cartons'],
  };
  return [...base, ...(extra[t.key] ?? [])];
}

export interface CommandeVocale {
  typeKey: string;
  resultat: string | null;
  camp: Camp;
  numero: number | null;
}

/** "plaquage manqué 7", "touche gagnée adversaire", "essai 11" */
export function analyserCommandeVocale(phrase: string, types: DefinitionTypeEvenement[]): CommandeVocale | null {
  let t = normaliser(phrase);
  const camp: Camp = /\b(adversaire|adverse|eux|en face)\b/.test(t) ? 'adversaire' : 'nous';
  t = t.replace(/\b(adversaire|adverse|eux|en face)\b/g, ' ');
  const { nombre, reste } = extraireNombre(t);
  let meilleur: { type: DefinitionTypeEvenement; long: number } | null = null;
  for (const ty of types) {
    for (const syn of synonymesType(ty)) {
      if (syn && reste.includes(syn) && (!meilleur || syn.length > meilleur.long)) meilleur = { type: ty, long: syn.length };
    }
  }
  if (!meilleur) return null;
  let resultat: string | null = null;
  let longRes = 0;
  for (const r of meilleur.type.resultats) {
    for (const cand of [normaliser(r.label), normaliser(r.value.replace(/_/g, ' '))]) {
      const racine = cand.split(' ')[0].slice(0, Math.max(4, cand.split(' ')[0].length - 1));
      if ((reste.includes(cand) || reste.split(' ').some((m) => m.startsWith(racine))) && cand.length > longRes) {
        resultat = r.value;
        longRes = cand.length;
      }
    }
  }
  if (!resultat && meilleur.type.resultats.length === 1) resultat = meilleur.type.resultats[0].value;
  return { typeKey: meilleur.type.key, resultat, camp, numero: nombre };
}

export interface JoueurRecherche {
  id: string;
  nom: string;
  prenom: string;
  numero?: number | null;
}

/** Recherche en langage naturel : "plaquages manqués de Dupont en 2e mi-temps dans nos 22". */
export function analyserRecherche(phrase: string, types: DefinitionTypeEvenement[], joueurs: JoueurRecherche[] = []): FiltreEvenements {
  let t = normaliser(phrase);
  const f: FiltreEvenements = {};
  if (/\b(1re|1ere|premiere) mi temps\b/.test(t)) f.miTemps = 1;
  if (/\b(2e|2eme|deuxieme|seconde) mi temps\b/.test(t)) f.miTemps = 2;
  if (/\b(adversaire|adverses?|eux|en face)\b/.test(t)) f.camp = 'adversaire';
  else if (/\b(nos|notre|nous)\b/.test(t) && !/\bnos 22\b/.test(t)) f.camp = 'nous';
  if (/\bnos 22\b/.test(t)) f.zonesLongueur = [0];
  if (/\b(leurs 22|22 adverses?|dans les 22)\b/.test(t)) f.zonesLongueur = [5];
  if (/\b(rates?|manques?|perdu(e|es|s)?|echoue(e|es|s)?)\b/.test(t)) f.succes = false;
  else if (/\b(reussi(e|es|s)?|gagne(e|es|s)?)\b/.test(t)) f.succes = true;

  const typesTrouves = new Set<string>();
  for (const ty of types) for (const syn of synonymesType(ty)) if (syn && new RegExp(`\\b${syn}`).test(t)) typesTrouves.add(ty.key);
  if (typesTrouves.size) f.types = [...typesTrouves];
  // Un résultat précis prime sur le simple succès/échec (ex. "plaquages dominants")
  for (const k of typesTrouves) {
    const ty = types.find((x) => x.key === k)!;
    const r = ty.resultats.find((r) => t.includes(normaliser(r.label)) || t.includes(normaliser(r.value.replace(/_/g, ' '))));
    if (r && ty.resultats.length > 1) { f.resultats = [...(f.resultats ?? []), r.value]; delete f.succes; }
  }
  for (const j of joueurs) {
    const nom = normaliser(j.nom);
    if (nom && new RegExp(`\\b${nom}\\b`).test(t)) (f.joueurs ??= []).push(j.id);
  }
  const num = t.match(/\b(?:numero|n|du|le) ?(\d{1,2})\b/);
  if (num && !f.joueurs?.length) {
    const n = Number(num[1]);
    const j = joueurs.find((x) => x.numero === n);
    if (j && f.camp !== 'adversaire') f.joueurs = [j.id];
    else f.numeros = [n];
  }
  t = '';
  return f;
}
