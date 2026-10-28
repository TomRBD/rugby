import { describe, expect, it } from 'vitest';
import {
  TAXONOMIE_DEFAUT, calculerStats, calculerTempsDeJeu, horlogeDepuisVideo, formatMinute, tranche,
  zoneDepuisCoordonnees, analyserCommandeVocale, analyserRecherche, appliquerFiltre, peut, equipesAccessibles,
  evaluerObjectifs, ratioAiguChronique, rapportAdverse, typesParNiveau, type Evenement,
} from './index.js';

const reperes = { dureeMiTemps: 40, coupEnvoi1: 100, coupEnvoi2: 3000 };
let n = 0;
const ev = (p: Partial<Evenement> & { typeKey: string }): Evenement => ({
  id: `e${++n}`, camp: 'nous', joueurs: [], attributs: {}, debut: 200, fin: 203, resultat: null, ...p,
});

describe('taxonomie', () => {
  it('propose environ 15 types en Express', () => {
    const express = typesParNiveau(TAXONOMIE_DEFAUT, 'express');
    expect(express.length).toBeGreaterThanOrEqual(14);
    expect(express.length).toBeLessThanOrEqual(18);
  });
  it('a des raccourcis uniques', () => {
    const r = TAXONOMIE_DEFAUT.map((t) => t.raccourci).filter(Boolean);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe('horloge', () => {
  it('convertit le timecode en minute de match', () => {
    expect(horlogeDepuisVideo(50, reperes)).toBeNull();
    expect(horlogeDepuisVideo(700, reperes)).toEqual({ miTemps: 1, secondes: 600 });
    expect(horlogeDepuisVideo(3060, reperes)).toEqual({ miTemps: 2, secondes: 2460 });
    expect(formatMinute({ miTemps: 1, secondes: 41 * 60 }, 40)).toBe("40+2'");
  });
  it('garde le temps additionnel dans la dernière tranche', () => {
    expect(tranche({ miTemps: 1, secondes: 43 * 60 }, 40)).toBe(3);
    expect(tranche({ miTemps: 2, secondes: 40 * 60 }, 40)).toBe(4);
  });
});

describe('temps de jeu', () => {
  const feuille = [
    { joueurId: 'a', numero: 1, titulaire: true },
    { joueurId: 'b', numero: 2, titulaire: true },
    { joueurId: 'c', numero: 16, titulaire: false },
    { joueurId: 'd', numero: 17, titulaire: false },
  ];
  it('gère remplacements, temporaires et cartons', () => {
    const r = calculerTempsDeJeu(feuille, [
      { type: 'temporaire_saignement', minute: 10, joueurSortant: 'a', joueurEntrant: 'c' },
      { type: 'retour', minute: 15, joueurSortant: 'c', joueurEntrant: 'a' },
      { type: 'carton_jaune', minute: 30, joueurSortant: 'b' },
      { type: 'remplacement', minute: 60, joueurSortant: 'a', joueurEntrant: 'd' },
      { type: 'carton_rouge', minute: 70, joueurSortant: 'd' },
    ], 40);
    expect(r.minutes).toEqual({ a: 55, b: 70, c: 5, d: 10 });
  });
});

describe('terrain', () => {
  it('découpe en 6 x 5 zones', () => {
    expect(zoneDepuisCoordonnees(10, 2)).toEqual({ longueur: 0, largeur: 0 });
    expect(zoneDepuisCoordonnees(85, 35)).toEqual({ longueur: 5, largeur: 2 });
    expect(zoneDepuisCoordonnees(100, 70)).toEqual({ longueur: 5, largeur: 4 });
  });
});

describe('stats', () => {
  const evs = [
    ev({ typeKey: 'essai', joueurs: ['a'], debut: 700, attributs: { origine: 'touche' } }),
    ev({ typeKey: 'transformation', joueurs: ['b'], resultat: 'reussie', debut: 760 }),
    ev({ typeKey: 'penalite_tentee', camp: 'adversaire', resultat: 'reussie', debut: 3100 }),
    ev({ typeKey: 'plaquage', joueurs: ['a'], resultat: 'dominant', debut: 800 }),
    ev({ typeKey: 'plaquage', joueurs: ['a'], resultat: 'manque', debut: 900 }),
    ev({ typeKey: 'touche', joueurs: ['b'], resultat: 'gagnee', attributs: { cible: 'fond', sauteur: 'a' }, debut: 1000 }),
    ev({ typeKey: 'touche', joueurs: ['b'], resultat: 'volee', attributs: { cible: 'fond' }, debut: 1100 }),
    ev({ typeKey: 'penalite', camp: 'adversaire', attributs: { motif: 'hors_jeu', provoquee_par: 'a' }, debut: 1200 }),
  ];
  const s = calculerStats(evs, {
    types: TAXONOMIE_DEFAUT, reperes,
    feuille: [{ joueurId: 'a', numero: 7, titulaire: true }, { joueurId: 'b', numero: 2, titulaire: true }],
  });
  it('calcule le score et les mi-temps', () => {
    expect(s.score).toEqual({ nous: 7, adversaire: 3 });
    expect(s.parMiTemps[0].nous.valeur).toBe(7);
    expect(s.parMiTemps[1].adversaire.valeur).toBe(3);
  });
  it('relie chaque stat à ses événements', () => {
    const pl = s.indicateurs.find((i) => i.key === 'plaquages_reussis')!;
    expect(pl.nous.valeur).toBe(50);
    expect(pl.nous.ids).toHaveLength(2);
    const t = s.indicateurs.find((i) => i.key === 'touches')!;
    expect(t.nous.valeur).toBe(50);
  });
  it('calcule les stats individuelles', () => {
    const a = s.joueurs.find((j) => j.joueurId === 'a')!;
    expect(a.valeurs.essais.valeur).toBe(1);
    expect(a.valeurs.points.valeur).toBe(5);
    expect(a.valeurs.sauts_gagnes.valeur).toBe(1);
    expect(a.valeurs.penalites_provoquees.valeur).toBe(1);
    expect(a.tempsDeJeu).toBe(80);
    const b = s.joueurs.find((j) => j.joueurId === 'b')!;
    expect(b.valeurs.tirs_reussis.valeur).toBe(1);
    expect(b.valeurs.touches_lancees.valeur).toBe(2);
  });
  it("répartit l'origine des essais", () => {
    const r = s.repartitions.find((x) => x.key === 'origine_essais')!;
    expect(r.lignes[0]).toMatchObject({ label: 'Touche', nous: { valeur: 1 } });
  });
  it('signale un joueur codé hors feuille', () => {
    const s2 = calculerStats([ev({ typeKey: 'plaquage', joueurs: ['zz'], resultat: 'passif' })], {
      types: TAXONOMIE_DEFAUT, reperes, feuille: [{ joueurId: 'a', numero: 1, titulaire: true }],
    });
    expect(s2.alertes.some((a) => a.message.includes('absent de la feuille'))).toBe(true);
  });
  it('évalue les objectifs', () => {
    const o = evaluerObjectifs(s, [{ key: 'plaquages_reussis', camp: 'nous', cible: 85 }, { key: 'points', camp: 'adversaire', cible: 15 }]);
    expect(o[0].atteint).toBe(false);
    expect(o[1].atteint).toBe(true);
  });
});

describe('saisie vocale et recherche', () => {
  it('comprend "plaquage manqué 7"', () => {
    expect(analyserCommandeVocale('Plaquage manqué 7', TAXONOMIE_DEFAUT)).toEqual({ typeKey: 'plaquage', resultat: 'manque', camp: 'nous', numero: 7 });
    expect(analyserCommandeVocale('touche volée adversaire', TAXONOMIE_DEFAUT)).toMatchObject({ typeKey: 'touche', resultat: 'volee', camp: 'adversaire' });
    expect(analyserCommandeVocale('essai numéro onze', TAXONOMIE_DEFAUT)).toMatchObject({ typeKey: 'essai', numero: 11 });
  });
  it('transforme une phrase en filtre', () => {
    const f = analyserRecherche('plaquages manqués de Dupont en 2e mi-temps', TAXONOMIE_DEFAUT, [{ id: 'p1', nom: 'Dupont', prenom: 'Antoine' }]);
    expect(f).toMatchObject({ types: ['plaquage'], resultats: ['manque'], joueurs: ['p1'], miTemps: 2 });
    const f2 = analyserRecherche('touches perdues dans nos 22', TAXONOMIE_DEFAUT);
    expect(f2).toMatchObject({ types: ['touche'], succes: false, zonesLongueur: [0] });
  });
  it('applique un filtre', () => {
    const evs = [ev({ typeKey: 'plaquage', resultat: 'manque', joueurs: ['p1'], debut: 3100 }), ev({ typeKey: 'plaquage', resultat: 'dominant', joueurs: ['p1'], debut: 3100 })];
    expect(appliquerFiltre(evs, { types: ['plaquage'], succes: false, miTemps: 2 }, TAXONOMIE_DEFAUT, reperes)).toHaveLength(1);
  });
});

describe('droits', () => {
  it('limite un entraîneur à son équipe', () => {
    const a = [{ role: 'entraineur' as const, equipeId: 'A' }];
    expect(peut(a, 'codage.ecrire', 'A')).toBe(true);
    expect(peut(a, 'codage.ecrire', 'B')).toBe(false);
    expect(peut(a, 'club.gerer', null)).toBe(false);
    expect(equipesAccessibles(a, 'match.lire')).toEqual(['A']);
  });
  it("interdit les données de santé à l'analyste", () => {
    expect(peut([{ role: 'analyste', equipeId: null }], 'sante.lire')).toBe(false);
    expect(peut([{ role: 'analyste', equipeId: null }, { role: 'medical', equipeId: null }], 'sante.lire')).toBe(true);
  });
});

describe('santé et adversaire', () => {
  it('calcule le ratio aigu/chronique', () => {
    const seances = Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 28 - i)).toISOString().slice(0, 10), rpe: 5, dureeMinutes: 60 }));
    const r = ratioAiguChronique(seances, '2026-10-28');
    expect(r.ratio).toBe(1);
    expect(r.zone).toBe('optimale');
  });
  it('repère les schémas adverses', () => {
    const s = calculerStats([], { types: TAXONOMIE_DEFAUT, reperes });
    const r = rapportAdverse([s], Array.from({ length: 5 }, () => ({ typeKey: 'touche', numeroAdverse: 2, attributs: { cible: 'devant' } })));
    expect(r.schemas[0]).toContain('devant');
    expect(r.joueursCles[0]).toMatchObject({ numero: 2, actions: 5 });
  });
});
