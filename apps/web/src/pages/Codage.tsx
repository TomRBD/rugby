// Codage post-match : une touche par action, pause automatique pour les attributs, saisie du joueur par numéro.
// Les écritures passent par la file locale (hors ligne possible) puis sont fusionnées côté serveur ; les autres codeurs
// connectés reçoivent les changements en direct (WebSocket).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  analyserCommandeVocale, calculerTempsDeJeu, controlesCoherence, estSucces, formatMinute, formatTimecode, horlogeDepuisVideo,
  libelleZone, pointsEvenement, typesParNiveau, videoDepuisHorloge, type Camp, type DefinitionTypeEvenement,
} from '@rugby/shared';
import { api, jeton } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees, useEnLigne, useRaccourcis } from '../lib/hooks';
import { cacherMatch, enfiler, matchEnCache, synchroniser, uuid } from '../lib/horsLigne';
import { Chargement, Erreur, useAction, useToast } from '../composants/ui';
import { LecteurVideo, VITESSES, type ApiLecteur } from '../composants/LecteurVideo';
import { Timeline } from '../composants/Timeline';
import { Terrain } from '../composants/Terrain';

export interface Ev {
  id: string;
  typeKey: string;
  camp: Camp;
  joueurs: string[];
  numeroAdverse?: number | null;
  resultat?: string | null;
  attributs: Record<string, any>;
  debut: number;
  fin: number;
  x?: number | null;
  y?: number | null;
  commentaire?: string | null;
  source?: string;
  aCompleter?: boolean;
  version: number;
  supprime?: boolean;
}

export const versApi = (e: Ev) => ({
  id: e.id, type_key: e.typeKey, camp: e.camp, joueurs: e.joueurs, numero_adverse: e.numeroAdverse ?? null, resultat: e.resultat ?? null,
  attributs: e.attributs ?? {}, debut: e.debut, fin: e.fin, x: e.x ?? null, y: e.y ?? null, commentaire: e.commentaire ?? null,
  source: e.source ?? 'manuel', a_completer: !!e.aCompleter, version: e.version, supprime: !!e.supprime,
});

const SECTEURS: Record<string, string[]> = {
  tout: [],
  avants: ['Mêlée', 'Touche', 'Ruck', 'Maul', 'Défense', 'Turnover', 'Discipline'],
  arrieres: ['Points', 'Attaque', 'Jeu au pied', 'Renvois', 'Possession', 'Turnover', 'Défense'],
};

/** État partagé du codage d'un match : chargement (ou cache hors ligne), écritures en file, fusion des changements reçus. */
export function useCodageMatch(matchId: string) {
  const { clubId } = useSession();
  const url = useClubApi();
  const [donnees, setDonnees] = useState<any | null>(null);
  const [evs, setEvs] = useState<Map<string, Ev>>(new Map());
  const [erreur, setErreur] = useState<string | null>(null);
  const derniereSynchro = useRef<string | null>(null);
  const cle = `${clubId}/${matchId}`;

  const fusionner = useCallback((liste: Ev[]) => {
    setEvs((m) => {
      const n = new Map(m);
      for (const e of liste) {
        const local = n.get(e.id);
        if (!local || (e.version ?? 0) >= (local.version ?? 0)) {
          if (e.supprime) n.delete(e.id); else n.set(e.id, e);
        }
      }
      return n;
    });
  }, []);

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [complet, types] = await Promise.all([api(url(`/matchs/${matchId}/complet`)), api(url('/taxonomie'))]);
        const d = { ...complet, types };
        await cacherMatch(cle, d).catch(() => undefined);
        if (!actif) return;
        setDonnees(d);
        derniereSynchro.current = new Date().toISOString();
        setEvs(new Map(complet.evenements.map((e: Ev) => [e.id, e])));
      } catch (e) {
        // Hors ligne : données mises en cache lors de la dernière ouverture
        const c = await matchEnCache<any>(cle).catch(() => undefined);
        if (!actif) return;
        if (c) { setDonnees(c); setEvs(new Map(c.evenements.map((x: Ev) => [x.id, x]))); }
        else setErreur((e as Error).message);
      }
    })();
    return () => { actif = false; };
  }, [url, matchId, cle]);

  const rafraichir = useCallback(async () => {
    if (!navigator.onLine || !derniereSynchro.current) return;
    const depuis = derniereSynchro.current;
    const r = await api(url(`/matchs/${matchId}/evenements?depuis=${encodeURIComponent(depuis)}`)).catch(() => null);
    if (r) { derniereSynchro.current = r.horodatage; fusionner(r.evenements); }
  }, [url, matchId, fusionner]);

  /** Écriture locale immédiate, puis envoi (ou mise en file si pas de réseau). */
  const ecrire = useCallback(async (e: Ev) => {
    // Version locale anticipée (le serveur incrémente de 1) : deux modifications rapprochées ne se contredisent pas
    const local = { ...e, version: (e.version ?? 0) + 1 };
    setEvs((m) => { const n = new Map(m); if (e.supprime) n.delete(e.id); else n.set(e.id, local); return n; });
    await enfiler({ id: uuid(), clubId: clubId!, matchId, evenement: versApi(e), le: Date.now() });
    const r = await synchroniser().catch(() => null);
    if (r?.conflits.length) fusionner(r.conflits.map((c: any) => c as Ev));
    void rafraichir();
  }, [clubId, matchId, fusionner, rafraichir]);

  // Mise en cache continue de l'état local (reprise hors ligne)
  useEffect(() => {
    if (donnees) void cacherMatch(cle, { ...donnees, evenements: [...evs.values()] }).catch(() => undefined);
  }, [evs, donnees, cle]);

  return { donnees, setDonnees, evs, ecrire, fusionner, rafraichir, erreur };
}

/** Codage collaboratif : présence des autres codeurs et événements reçus en direct. */
function useCollaboratif(matchId: string, secteur: string, surEvenements: (e: Ev[]) => void, surReperes: (r: any) => void) {
  const { clubId } = useSession();
  const [codeurs, setCodeurs] = useState<{ nom: string; secteur: string | null }[]>([]);
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    let ferme = false;
    let tentative = 0;
    const connecter = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const s = new WebSocket(`${proto}://${location.host}/api/ws/matchs/${matchId}?club=${clubId}&jeton=${encodeURIComponent(jeton() ?? '')}&secteur=${secteur}`);
      ws.current = s;
      s.onopen = () => { tentative = 0; };
      s.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.type === 'presence') setCodeurs(d.codeurs);
        if (d.type === 'evenements') surEvenements(d.evenements);
        if (d.type === 'reperes') surReperes(d);
      };
      s.onclose = () => { if (!ferme) setTimeout(connecter, Math.min(30000, 1000 * 2 ** tentative++)); };
    };
    connecter();
    return () => { ferme = true; ws.current?.close(); };
  }, [matchId, clubId, secteur, surEvenements, surReperes]);
  return codeurs;
}

export default function Codage() {
  const { id } = useParams();
  const matchId = id!;
  const url = useClubApi();
  const toast = useToast();
  const action = useAction();
  const { peut } = useSession();
  const enLigne = useEnLigne();
  const { donnees, setDonnees, evs, ecrire, fusionner, rafraichir, erreur } = useCodageMatch(matchId);
  const lecture = useDonnees<any[]>(url(`/matchs/${matchId}/lecture`));
  const propositions = useDonnees<any[]>(url(`/matchs/${matchId}/propositions`));
  const lecteur = useRef<ApiLecteur>(null);
  const [temps, setTemps] = useState(0);
  const [camp, setCamp] = useState<Camp>('nous');
  const [selection, setSelection] = useState<string | null>(null);
  const [edition, setEdition] = useState<Ev | null>(null);
  const [secteur, setSecteur] = useState<string>(() => localStorage.getItem('rugby.secteur') ?? 'tout');
  const [niveau, setNiveau] = useState<'express' | 'complet' | null>(null);
  const [ecoute, setEcoute] = useState(false);
  const historique = useRef<string[]>([]);

  const surReperes = useCallback((r: any) => setDonnees((d: any) => (d ? { ...d, match: { ...d.match, coup_envoi_1: r.coup_envoi_1, coup_envoi_2: r.coup_envoi_2 } } : d)), [setDonnees]);
  const codeurs = useCollaboratif(matchId, secteur, fusionner, surReperes);

  const sources = useMemo(() => (lecture.donnees ?? []).filter((v) => v.pret), [lecture.donnees]);
  const types: DefinitionTypeEvenement[] = useMemo(() => {
    if (!donnees) return [];
    const n = niveau ?? donnees.match.niveau_codage;
    const familles = SECTEURS[secteur] ?? [];
    return typesParNiveau(donnees.types, n).filter((t) => !familles.length || familles.includes(t.famille));
  }, [donnees, niveau, secteur]);
  const tousTypes: DefinitionTypeEvenement[] = donnees?.types ?? [];
  const reperes = donnees ? { dureeMiTemps: donnees.match.duree_mi_temps, coupEnvoi1: donnees.match.coup_envoi_1, coupEnvoi2: donnees.match.coup_envoi_2 } : null;
  const liste = useMemo(() => [...evs.values()].sort((a, b) => a.debut - b.debut), [evs]);
  const feuille: any[] = donnees?.feuille ?? [];
  const tdj = useMemo(() => (donnees ? calculerTempsDeJeu(feuille, donnees.changements, donnees.match.duree_mi_temps) : null), [donnees, feuille]);
  const score = useMemo(() => {
    const s = { nous: 0, adversaire: 0 };
    for (const e of liste) s[e.camp] += pointsEvenement(tousTypes.find((t) => t.key === e.typeKey), e.resultat);
    return s;
  }, [liste, tousTypes]);
  const alertes = useMemo(() => (reperes ? controlesCoherence(liste, { types: tousTypes, reperes, feuille, changements: donnees?.changements }) : []), [liste, tousTypes, reperes, feuille, donnees]);
  const alertesParEv = useMemo(() => new Map(alertes.filter((a) => a.evenementId).map((a) => [a.evenementId!, a.message])), [alertes]);
  // Compteur de phases : rucks depuis la dernière possession ou le dernier arrêt
  const phases = useMemo(() => {
    let n = 0;
    for (const e of liste.filter((x) => x.debut <= temps)) {
      if (e.typeKey === 'ruck') n++;
      else if (['melee', 'touche', 'renvoi', 'penalite', 'essai', 'turnover', 'possession'].includes(e.typeKey)) n = 0;
    }
    return n;
  }, [liste, temps]);

  const creer = useCallback((type: DefinitionTypeEvenement, base?: Partial<Ev>) => {
    const t = lecteur.current?.temps() ?? temps;
    lecteur.current?.pause();
    const e: Ev = {
      id: uuid(), typeKey: type.key, camp, joueurs: [], attributs: {}, debut: Math.max(0, t - 0.5), fin: t + type.dureeDefaut, version: 0,
      resultat: type.resultats.length === 1 ? type.resultats[0].value : null, source: 'manuel', ...base,
    };
    setEdition(e);
    setSelection(e.id);
  }, [camp, temps]);

  const valider = useCallback(async (e: Ev) => {
    const neuf = !evs.has(e.id);
    await ecrire({ ...e, aCompleter: false });
    if (neuf) historique.current.push(e.id);
    setEdition(null);
    lecteur.current?.lire();
  }, [ecrire, evs]);

  const supprimer = useCallback(async (idEv: string) => {
    const e = evs.get(idEv);
    if (!e) return;
    await ecrire({ ...e, supprime: true });
    toast('Action supprimée');
  }, [evs, ecrire, toast]);

  const placerRepere = async (cle: 'coup_envoi_1' | 'coup_envoi_2') => {
    const t = lecteur.current?.temps() ?? 0;
    const r = await action(() => api(url(`/matchs/${matchId}/reperes`), { methode: 'PATCH', corps: { [cle]: t } }), `Repère placé à ${formatTimecode(t)}`);
    if (r) surReperes(r);
  };

  // Actions codées en live : horodatées sur l'horloge du match, recalées sur la vidéo via les repères
  const aRecaler = liste.filter((e) => e.source === 'live' && e.attributs?.horloge != null && !e.attributs?.recale);
  const recalerLive = async () => {
    if (!reperes?.coupEnvoi1) return toast('Placez d\'abord le coup d\'envoi de la 1re mi-temps', true);
    for (const e of aRecaler) {
      const t = videoDepuisHorloge(Number(e.attributs.horloge), reperes);
      if (t == null) continue;
      await ecrire({ ...e, debut: t, fin: t + (e.fin - e.debut), attributs: { ...e.attributs, recale: true } });
    }
    toast(`${aRecaler.length} action(s) live recalée(s) sur la vidéo`);
  };

  // Saisie vocale : « plaquage manqué 7 », « touche gagnée adversaire »
  const reconnaissance = useRef<any>(null);
  const basculerVoix = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return toast('Saisie vocale non disponible dans ce navigateur (utilisez Chrome ou Edge)', true);
    if (ecoute) { reconnaissance.current?.stop(); setEcoute(false); return; }
    const r = new SR();
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (ev: any) => {
      const phrase = ev.results[ev.results.length - 1][0].transcript;
      const c = analyserCommandeVocale(phrase, tousTypes);
      if (!c) return toast(`Non compris : « ${phrase} »`, true);
      const type = tousTypes.find((t) => t.key === c.typeKey)!;
      const t = lecteur.current?.temps() ?? 0;
      const joueur = c.camp === 'nous' && c.numero ? feuille.find((f) => f.numero === c.numero)?.joueurId : undefined;
      const e: Ev = {
        id: uuid(), typeKey: type.key, camp: c.camp, joueurs: joueur ? [joueur] : [], numeroAdverse: c.camp === 'adversaire' ? c.numero : null,
        resultat: c.resultat, attributs: {}, debut: Math.max(0, t - 1), fin: t + type.dureeDefaut, version: 0, source: 'vocal',
        aCompleter: !c.resultat,
      };
      void ecrire(e);
      toast(`${type.label}${c.resultat ? ` ${type.resultats.find((x) => x.value === c.resultat)?.label}` : ''}${c.numero ? ` n° ${c.numero}` : ''}`);
    };
    r.onend = () => setEcoute(false);
    r.start();
    reconnaissance.current = r;
    setEcoute(true);
  };

  useRaccourcis((e) => {
    if (edition) return;
    const l = lecteur.current;
    if (!l) return;
    if (e.key === ' ') { e.preventDefault(); l.basculer(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); l.aller(l.temps() - (e.shiftKey ? 10 : 2)); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); l.aller(l.temps() + (e.shiftKey ? 10 : 2)); return; }
    if (e.key === ',') { l.image(-1); return; }
    if (e.key === '.') { l.image(1); return; }
    if (e.key === '[' || e.key === ']') {
      const i = VITESSES.indexOf(l.vitesse());
      l.vitesse(VITESSES[Math.min(VITESSES.length - 1, Math.max(0, i + (e.key === ']' ? 1 : -1)))]);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); setCamp((c) => (c === 'nous' ? 'adversaire' : 'nous')); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      const dernier = historique.current.pop();
      if (dernier) void supprimer(dernier);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'd' && liste.length) {
      // Duplication de la dernière action codée avant la position courante
      const dernier = [...liste].reverse().find((x) => x.debut <= l.temps()) ?? liste[liste.length - 1];
      const t = l.temps();
      void ecrire({ ...dernier, id: uuid(), debut: Math.max(0, t - 0.5), fin: t + (dernier.fin - dernier.debut), version: 0 });
      toast(`Dupliqué : ${tousTypes.find((x) => x.key === dernier.typeKey)?.label}`);
      return;
    }
    if (e.key === 'Delete' && selection) { void supprimer(selection); return; }
    const type = types.find((t) => t.raccourci === e.key.toLowerCase());
    if (type) { e.preventDefault(); creer(type); }
  });

  if (erreur) return <Erreur message={erreur} />;
  if (!donnees) return <Chargement />;
  const { match } = donnees;
  if (!peut('codage.ecrire', match.equipe_id)) return <Erreur message="Vous n'avez pas les droits de codage sur cette équipe." />;
  const enAttente = (propositions.donnees ?? []).filter((p) => p.statut === 'en_attente');
  const periodes = enAttente.filter((p) => ['temps_mort', 'mi_temps'].includes(p.type)).map((p) => ({ debut: p.debut, fin: p.fin, libelle: p.type === 'mi_temps' ? 'Mi-temps probable' : 'Temps mort probable' }));
  const minute = reperes ? formatMinute(horlogeDepuisVideo(temps, reperes), match.duree_mi_temps) : '';

  return (
    <div className="pile">
      <div className="entete-page">
        <div>
          <h1 style={{ marginBottom: 4 }}>Codage : {match.equipe_nom} - {match.adversaire_nom ?? 'Adversaire'}</h1>
          <div className="ligne petit">
            <Link to={`/matchs/${matchId}`}>Retour au match</Link>
            <span className="badge">{liste.length} actions</span>
            {!enLigne && <span className="badge orange">Hors ligne : enregistrement local</span>}
            {codeurs.length > 1 && <span className="badge bleu">{codeurs.length} codeurs : {codeurs.map((c) => `${c.nom}${c.secteur && c.secteur !== 'tout' ? ` (${c.secteur})` : ''}`).join(', ')}</span>}
          </div>
        </div>
        <div className="ligne">
          <span className="chiffre" aria-live="polite">{score.nous} - {score.adversaire}</span>
          <span className="badge">{minute || 'Placez le coup d\'envoi'}</span>
          <span className="badge">{phases} phase(s)</span>
        </div>
      </div>

      <div className="codage">
        <div className="pile">
          <LecteurVideo ref={lecteur} sources={sources} onTemps={setTemps} />
          <Timeline duree={sources[0]?.duree ?? 0} temps={temps} evenements={liste} periodes={periodes} vignettes={sources[0]?.vignettes}
            onAller={(t) => lecteur.current?.aller(t)} onSelection={setSelection} />
          <div className="ligne">
            <div className="camp-bascule" role="group" aria-label="Équipe en action (Tab)">
              <button className={`nous ${camp === 'nous' ? 'actif' : ''}`} onClick={() => setCamp('nous')}>{match.equipe_nom}</button>
              <button className={`adversaire ${camp === 'adversaire' ? 'actif' : ''}`} onClick={() => setCamp('adversaire')}>{match.adversaire_nom ?? 'Adversaire'}</button>
            </div>
            <select className="saisie" style={{ width: 'auto' }} value={secteur} onChange={(e) => { setSecteur(e.target.value); localStorage.setItem('rugby.secteur', e.target.value); }} aria-label="Secteur">
              <option value="tout">Toutes les actions</option><option value="avants">Secteur avants</option><option value="arrieres">Secteur arrières</option>
            </select>
            <select className="saisie" style={{ width: 'auto' }} value={niveau ?? match.niveau_codage} onChange={(e) => setNiveau(e.target.value as any)} aria-label="Niveau">
              <option value="express">Express</option><option value="complet">Complet</option>
            </select>
            <button className="bouton petit" onClick={() => placerRepere('coup_envoi_1')}>Coup d'envoi 1re MT ici</button>
            <button className="bouton petit" onClick={() => placerRepere('coup_envoi_2')}>Coup d'envoi 2e MT ici</button>
            <button className={`bouton petit ${ecoute ? 'primaire' : ''}`} onClick={basculerVoix}>{ecoute ? 'Écoute en cours…' : 'Saisie vocale'}</button>
            {aRecaler.length > 0 && <button className="bouton petit" onClick={recalerLive}>Recaler les {aRecaler.length} actions live</button>}
          </div>
          <div className="boutons-codage">
            {types.map((t) => (
              <button key={t.key} className="bouton-ev" onClick={() => creer(t)} title={t.famille}>
                <strong>{t.label}</strong>
                {t.raccourci && <kbd>{t.raccourci.toUpperCase()}</kbd>}
              </button>
            ))}
          </div>
          <details className="petit">
            <summary>Raccourcis clavier</summary>
            <p>Espace : lecture/pause · ← → : 2 s (Maj : 10 s) · , et . : image par image · [ ] : vitesse · Tab : changer d'équipe · D : dupliquer la dernière action · Ctrl+Z : annuler la dernière action · Suppr : supprimer l'action sélectionnée.
              Après une touche d'action : chiffre pour le résultat, puis numéro du joueur, Entrée pour valider, Échap pour annuler.</p>
          </details>
        </div>

        <div className="pile">
          {edition ? (
            <PanneauAction ev={edition} types={tousTypes} feuille={feuille} tdj={tdj} reperes={reperes} effectif={donnees.effectif} joueursAdverses={donnees.joueursAdverses}
              equipe={match.equipe_nom} adversaire={match.adversaire_nom ?? 'Adversaire'}
              onChange={setEdition} onValider={valider} onAnnuler={() => { setEdition(null); }} onSupprimer={evs.has(edition.id) ? () => { void supprimer(edition.id); setEdition(null); } : undefined} />
          ) : (
            <div className="carte pile">
              <div className="ligne entre"><h2 style={{ margin: 0 }}>Actions codées</h2>
                <button className="bouton petit" onClick={() => void rafraichir()}>Actualiser</button></div>
              <div className="liste-ev">
                {[...liste].reverse().map((e) => {
                  const t = tousTypes.find((x) => x.key === e.typeKey);
                  const res = t?.resultats.find((r) => r.value === e.resultat)?.label;
                  const joueur = feuille.find((f) => f.joueurId === e.joueurs[0]);
                  const s = estSucces(t, e.resultat);
                  return (
                    <div key={e.id} className={`ev-ligne ${e.camp} ${selection === e.id ? 'selection' : ''} ${e.aCompleter ? 'a-completer' : ''}`}
                      onClick={() => { setSelection(e.id); lecteur.current?.aller(e.debut); }} onDoubleClick={() => setEdition(e)}>
                      <span className="petit">{reperes ? formatMinute(horlogeDepuisVideo(e.debut, reperes), match.duree_mi_temps) || formatTimecode(e.debut) : formatTimecode(e.debut)}</span>
                      <span>
                        <strong>{t?.label ?? e.typeKey}</strong> {res && <span className={s === false ? 'adv' : ''}>{res}</span>}
                        {joueur && <span className="muet"> · {joueur.numero}. {joueur.nom}</span>}
                        {e.numeroAdverse && <span className="muet"> · n° {e.numeroAdverse}</span>}
                        {alertesParEv.has(e.id) && <span className="badge orange" title={alertesParEv.get(e.id)}>!</span>}
                        {e.aCompleter && <span className="badge orange">à compléter</span>}
                      </span>
                      <button className="bouton petit discret" onClick={(ev) => { ev.stopPropagation(); setEdition(e); }}>Modifier</button>
                    </div>
                  );
                })}
                {!liste.length && <p className="muet">Lancez la vidéo et appuyez sur la touche d'une action (par exemple P pour un plaquage).</p>}
              </div>
            </div>
          )}

          {enAttente.length > 0 && (
            <div className="carte pile">
              <h3 style={{ margin: 0 }}>Propositions de l'IA ({enAttente.length})</h3>
              <p className="muet petit">À valider ou rejeter : rien n'est ajouté sans votre accord.</p>
              <div className="liste-ev" style={{ maxHeight: 260 }}>
                {enAttente.map((p) => (
                  <div key={p.id} className="ev-ligne" style={{ gridTemplateColumns: '64px 1fr auto' }} onClick={() => lecteur.current?.aller(p.debut)}>
                    <span className="petit">{formatTimecode(p.debut)}</span>
                    <span>{({ temps_mort: 'Temps mort', mi_temps: 'Mi-temps', coup_envoi_1: 'Coup d\'envoi 1re MT', coup_envoi_2: 'Coup d\'envoi 2e MT', arret_jeu: 'Arrêt de jeu sifflé' } as Record<string, string>)[p.type] ?? tousTypes.find((t) => t.key === p.type)?.label ?? p.type}
                      <span className="muet petit"> · confiance {Math.round(p.confiance * 100)} %</span></span>
                    <span className="ligne" style={{ gap: 4 }}>
                      {(p.type.startsWith('coup_envoi') || tousTypes.some((t) => t.key === p.type)) && (
                        <button className="bouton petit" onClick={async (ev) => {
                          ev.stopPropagation();
                          const r = await action(() => api(url(`/propositions/${p.id}/valider`), { corps: { id: uuid(), camp } }), 'Proposition validée');
                          if (r) { fusionner(r.evenements); void propositions.recharger(); if (p.type.startsWith('coup_envoi')) surReperes({ ...match, [p.type]: p.debut }); }
                        }}>Valider</button>
                      )}
                      {p.type === 'arret_jeu' && (
                        <select className="saisie" style={{ width: 110, minHeight: 30 }} value="" onClick={(ev) => ev.stopPropagation()} onChange={(ev) => {
                          const type = tousTypes.find((t) => t.key === ev.target.value);
                          if (!type) return;
                          lecteur.current?.aller(p.debut);
                          creer(type, { debut: p.debut, fin: p.fin, source: 'ia_validee' });
                          void api(url(`/propositions/${p.id}/rejeter`), { corps: {} }).then(() => propositions.recharger());
                        }} aria-label="Qualifier l'arrêt de jeu">
                          <option value="">Qualifier…</option>
                          {tousTypes.filter((t) => ['melee', 'touche', 'penalite', 'renvoi', 'en_avant', 'essai'].includes(t.key)).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      )}
                      <button className="bouton petit discret" onClick={(ev) => { ev.stopPropagation(); void action(() => api(url(`/propositions/${p.id}/rejeter`), { corps: {} })).then(() => propositions.recharger()); }}>Rejeter</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Panneau de saisie des détails d'une action (clavier : chiffre du résultat, numéro du joueur, Entrée). */
export function PanneauAction({ ev, types, feuille, tdj, reperes, effectif, joueursAdverses, equipe, adversaire, onChange, onValider, onAnnuler, onSupprimer }: {
  ev: Ev; types: DefinitionTypeEvenement[]; feuille: any[]; tdj: ReturnType<typeof calculerTempsDeJeu> | null; reperes: any; effectif: any[]; joueursAdverses: any[];
  equipe: string; adversaire: string;
  onChange: (e: Ev) => void; onValider: (e: Ev) => void; onAnnuler: () => void; onSupprimer?: () => void;
}) {
  const type = types.find((t) => t.key === ev.typeKey);
  const [etape, setEtape] = useState<'resultat' | 'joueur'>(ev.resultat ? 'joueur' : 'resultat');
  const [numero, setNumero] = useState('');
  const refNumero = useRef<HTMLInputElement>(null);
  const refPanneau = useRef<HTMLDivElement>(null);
  const minute = reperes ? horlogeDepuisVideo(ev.debut, reperes) : null;
  useEffect(() => { (etape === 'joueur' ? refNumero.current : refPanneau.current)?.focus(); }, [etape]);
  if (!type) return null;
  const maj = (p: Partial<Ev>) => onChange({ ...ev, ...p });
  const choisirNumero = (v: string) => {
    setNumero(v);
    const n = Number(v);
    if (!v) return maj(ev.camp === 'nous' ? { joueurs: [] } : { numeroAdverse: null });
    if (ev.camp === 'nous') {
      const j = feuille.find((f) => f.numero === n);
      maj({ joueurs: j ? [j.joueurId] : [] });
    } else maj({ numeroAdverse: n });
  };
  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onAnnuler(); return; }
    if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) { e.preventDefault(); onValider(ev); return; }
    if (etape === 'resultat' && /^[1-9]$/.test(e.key) && !(e.target as HTMLElement).matches('input, select, textarea')) {
      const r = type.resultats[Number(e.key) - 1];
      if (r) { e.preventDefault(); maj({ resultat: r.value }); setEtape('joueur'); }
    }
  };
  const joueurSel = ev.camp === 'nous' ? feuille.find((f) => f.joueurId === ev.joueurs[0]) : null;
  const surTerrain = (jid: string) => !tdj || !minute || (tdj.intervalles[jid] ?? []).some((iv) => minute.secondes / 60 >= iv.debut && minute.secondes / 60 <= iv.fin);

  return (
    <div className="carte pile" ref={refPanneau} tabIndex={-1} onKeyDown={clavier} style={{ borderTop: `4px solid ${ev.camp === 'nous' ? 'var(--nous)' : 'var(--adv)'}` }}>
      <div className="ligne entre">
        <h2 style={{ margin: 0 }}>{type.label}</h2>
        <div className="camp-bascule">
          <button className={`nous ${ev.camp === 'nous' ? 'actif' : ''}`} onClick={() => maj({ camp: 'nous', numeroAdverse: null })}>{equipe}</button>
          <button className={`adversaire ${ev.camp === 'adversaire' ? 'actif' : ''}`} onClick={() => maj({ camp: 'adversaire', joueurs: [] })}>{adversaire}</button>
        </div>
      </div>
      <span className="muet petit">{formatTimecode(ev.debut)}{minute ? ` · ${formatMinute(minute, reperes.dureeMiTemps)}` : ''}{type.sensCamp === 'fautif' ? ' · équipe fautive' : type.sensCamp === 'defense' ? ' · équipe qui plaque' : ''}</span>
      {type.resultats.length > 1 && (
        <div>
          <div className="petit muet">Résultat {etape === 'resultat' && '(tapez le chiffre)'}</div>
          <div className="choix-rapide">
            {type.resultats.map((r, i) => (
              <button key={r.value} className={ev.resultat === r.value ? 'actif' : ''} onClick={() => { maj({ resultat: r.value }); setEtape('joueur'); }}>
                <kbd>{i + 1}</kbd> {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="champ"><span>{ev.camp === 'nous' ? 'Joueur (numéro)' : 'Numéro adverse'}</span>
          <input ref={refNumero} className="saisie" inputMode="numeric" value={numero || (ev.camp === 'nous' ? joueurSel?.numero ?? '' : ev.numeroAdverse ?? '')} onChange={(e) => choisirNumero(e.target.value.replace(/\D/g, ''))} />
        </label>
        {ev.camp === 'nous' && (
          <div className="compo-mini" style={{ marginTop: 6 }}>
            {feuille.map((f) => (
              <button key={f.joueurId} className={`${ev.joueurs.includes(f.joueurId) ? 'actif' : ''} ${surTerrain(f.joueurId) ? '' : 'hors-terrain'}`} title={`${f.prenom} ${f.nom}${surTerrain(f.joueurId) ? '' : ' (pas sur le terrain)'}`}
                onClick={() => { setNumero(String(f.numero)); maj({ joueurs: [f.joueurId] }); }}>{f.numero}</button>
            ))}
          </div>
        )}
        {joueurSel && <div className="petit">{joueurSel.prenom} {joueurSel.nom}{!surTerrain(joueurSel.joueurId) && <span className="badge orange" style={{ marginLeft: 6 }}>pas sur le terrain à cette minute</span>}</div>}
        {ev.camp === 'adversaire' && ev.numeroAdverse && <div className="petit">{joueursAdverses.find((j) => j.numero === ev.numeroAdverse)?.nom ?? ''}</div>}
        {!feuille.length && ev.camp === 'nous' && <p className="petit muet">Feuille de match vide : remplissez-la pour saisir les joueurs par numéro.</p>}
      </div>
      {type.attributs.map((a) => (
        <label key={a.key} className="champ"><span>{a.label}</span>
          {a.type === 'choix' ? (
            <select value={ev.attributs[a.key] ?? ''} onChange={(e) => maj({ attributs: { ...ev.attributs, [a.key]: e.target.value || undefined } })}>
              <option value="">-</option>{a.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : a.type === 'nombre' ? (
            <input type="number" value={ev.attributs[a.key] ?? ''} onChange={(e) => maj({ attributs: { ...ev.attributs, [a.key]: e.target.value === '' ? undefined : Number(e.target.value) } })} />
          ) : a.type === 'booleen' ? (
            <input type="checkbox" checked={!!ev.attributs[a.key]} onChange={(e) => maj({ attributs: { ...ev.attributs, [a.key]: e.target.checked || undefined } })} style={{ width: 22, minHeight: 22 }} />
          ) : a.type === 'joueur' ? (
            <select value={ev.attributs[a.key] ?? ''} onChange={(e) => maj({ attributs: { ...ev.attributs, [a.key]: e.target.value || undefined } })}>
              <option value="">-</option>{(feuille.length ? feuille : effectif.map((j: any) => ({ joueurId: j.id, numero: j.numero_habituel ?? '', prenom: j.prenom, nom: j.nom }))).map((f: any) => <option key={f.joueurId} value={f.joueurId}>{f.numero}. {f.prenom} {f.nom}</option>)}
            </select>
          ) : (
            <input value={ev.attributs[a.key] ?? ''} onChange={(e) => maj({ attributs: { ...ev.attributs, [a.key]: e.target.value || undefined } })} />
          )}
        </label>
      ))}
      <div>
        <div className="petit muet">Position sur le terrain (clic) {ev.x != null && `: ${libelleZone(ev.x, ev.y ?? 35)}`}</div>
        <Terrain selection={ev.x != null ? { x: ev.x, y: ev.y ?? 35 } : null} onClic={(x, y) => maj({ x, y })} hauteurMax={190} />
      </div>
      <div className="ligne">
        <label className="champ" style={{ flex: 1 }}><span>Début (s)</span><input type="number" step={0.5} value={Math.round(ev.debut * 10) / 10} onChange={(e) => maj({ debut: Number(e.target.value) })} /></label>
        <label className="champ" style={{ flex: 1 }}><span>Fin (s)</span><input type="number" step={0.5} value={Math.round(ev.fin * 10) / 10} onChange={(e) => maj({ fin: Number(e.target.value) })} /></label>
      </div>
      <label className="champ"><span>Commentaire</span><textarea rows={2} value={ev.commentaire ?? ''} onChange={(e) => maj({ commentaire: e.target.value || null })} /></label>
      <div className="ligne">
        <button className="bouton primaire" onClick={() => onValider(ev)}>Valider (Entrée)</button>
        <button className="bouton" onClick={onAnnuler}>Annuler (Échap)</button>
        {onSupprimer && <button className="bouton danger" onClick={onSupprimer}>Supprimer</button>}
      </div>
    </div>
  );
}
