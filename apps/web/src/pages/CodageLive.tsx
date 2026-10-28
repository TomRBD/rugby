// Codage live sur tablette au bord du terrain : gros boutons, horodatage seul, 100 % hors ligne.
// Les actions sont horodatées sur l'horloge du match puis recalées sur la vidéo grâce aux repères de coup d'envoi.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatTimecode, pointsEvenement, typesParNiveau, type Camp, type DefinitionTypeEvenement } from '@rugby/shared';
import { useEnLigne } from '../lib/hooks';
import { uuid } from '../lib/horsLigne';
import { Chargement, Erreur } from '../composants/ui';
import { useCodageMatch, type Ev } from './Codage';

interface Chrono {
  miTemps: 1 | 2;
  demarreA: number | null; // horodatage du dernier démarrage
  cumul: number; // secondes écoulées dans la mi-temps avant le dernier démarrage
}

export default function CodageLive() {
  const { id } = useParams();
  const matchId = id!;
  const enLigne = useEnLigne();
  const { donnees, evs, ecrire, erreur } = useCodageMatch(matchId);
  const cle = `rugby.chrono.${matchId}`;
  const [chrono, setChrono] = useState<Chrono>(() => {
    try { return JSON.parse(localStorage.getItem(cle) ?? '') as Chrono; } catch { return { miTemps: 1, demarreA: null, cumul: 0 }; }
  });
  const [maintenant, setMaintenant] = useState(Date.now());
  const [camp, setCamp] = useState<Camp>('nous');
  const [dernier, setDernier] = useState<Ev | null>(null);
  const [numero, setNumero] = useState('');

  useEffect(() => { localStorage.setItem(cle, JSON.stringify(chrono)); }, [chrono, cle]);
  useEffect(() => { const t = setInterval(() => setMaintenant(Date.now()), 250); return () => clearInterval(t); }, []);
  // Garde l'écran allumé pendant le match (si le navigateur le permet)
  useEffect(() => {
    let verrou: any;
    (navigator as any).wakeLock?.request('screen').then((v: any) => { verrou = v; }).catch(() => undefined);
    return () => { verrou?.release?.(); };
  }, []);

  const duree = donnees?.match.duree_mi_temps ?? 40;
  const secondesMiTemps = chrono.cumul + (chrono.demarreA ? (maintenant - chrono.demarreA) / 1000 : 0);
  const horloge = (chrono.miTemps - 1) * duree * 60 + secondesMiTemps;
  const types: DefinitionTypeEvenement[] = useMemo(() => (donnees ? typesParNiveau(donnees.types, 'express') : []), [donnees]);
  const liste = useMemo(() => [...evs.values()].filter((e) => e.source === 'live').sort((a, b) => b.debut - a.debut), [evs]);
  const score = useMemo(() => {
    const s = { nous: 0, adversaire: 0 };
    for (const e of evs.values()) s[e.camp] += pointsEvenement(donnees?.types.find((t: any) => t.key === e.typeKey), e.resultat);
    return s;
  }, [evs, donnees]);

  if (erreur) return <Erreur message={erreur} />;
  if (!donnees) return <Chargement />;
  const feuille: any[] = donnees.feuille;

  const appuyer = (t: DefinitionTypeEvenement) => {
    // Horodatage seul : le détail se complète après coup dans l'écran de codage
    const e: Ev = {
      id: uuid(), typeKey: t.key, camp, joueurs: [], attributs: { horloge: Math.round(horloge) }, debut: Math.round(horloge), fin: Math.round(horloge) + t.dureeDefaut,
      resultat: t.resultats.length === 1 ? t.resultats[0].value : null, source: 'live', aCompleter: true, version: 0,
    };
    void ecrire(e);
    setDernier({ ...e, version: 1 });
    setNumero('');
    if (navigator.vibrate) navigator.vibrate(40);
  };
  const completer = (p: Partial<Ev>) => {
    if (!dernier) return;
    const e = { ...dernier, ...p };
    const type = types.find((t) => t.key === e.typeKey);
    e.aCompleter = (type?.resultats.length ?? 0) > 1 && !e.resultat;
    void ecrire({ ...e, version: dernier.version });
    setDernier({ ...e, version: dernier.version + 1 });
  };
  const choisirNumero = (n: string) => {
    setNumero(n);
    if (!dernier) return;
    if (dernier.camp === 'nous') {
      const j = feuille.find((f) => f.numero === Number(n));
      completer({ joueurs: j ? [j.joueurId] : [] });
    } else completer({ numeroAdverse: Number(n) || null });
  };
  const typeDernier = dernier ? types.find((t) => t.key === dernier.typeKey) : null;

  return (
    <div className="live">
      <div className="ligne entre">
        <Link to={`/matchs/${matchId}`} className="bouton">Retour</Link>
        <strong>{donnees.match.equipe_nom} - {donnees.match.adversaire_nom ?? 'Adversaire'}</strong>
        <span className={`badge ${enLigne ? 'vert' : 'orange'}`}>{enLigne ? 'Synchronisé en direct' : 'Hors ligne : tout est enregistré sur la tablette'}</span>
      </div>
      <div className="carte ligne entre">
        <div>
          <div className="chrono" aria-live="off">{formatTimecode(horloge)}</div>
          <span className="muet">{chrono.miTemps === 1 ? '1re' : '2e'} mi-temps</span>
        </div>
        <div className="chrono">{score.nous} - {score.adversaire}</div>
        <div className="ligne">
          {chrono.demarreA ? (
            <button className="bouton" style={{ minHeight: 60, fontSize: '1.1rem' }} onClick={() => setChrono({ ...chrono, demarreA: null, cumul: secondesMiTemps })}>Arrêter le chrono</button>
          ) : (
            <button className="bouton primaire" style={{ minHeight: 60, fontSize: '1.1rem' }} onClick={() => setChrono({ ...chrono, demarreA: Date.now() })}>{secondesMiTemps === 0 ? 'Coup d\'envoi' : 'Reprendre'}</button>
          )}
          {chrono.miTemps === 1 && !chrono.demarreA && secondesMiTemps > 0 && (
            <button className="bouton" style={{ minHeight: 60 }} onClick={() => setChrono({ miTemps: 2, demarreA: null, cumul: 0 })}>Passer en 2e mi-temps</button>
          )}
        </div>
      </div>
      <div className="camp-bascule" style={{ alignSelf: 'start' }}>
        <button style={{ minHeight: 64, minWidth: 180, fontSize: '1.15rem' }} className={`nous ${camp === 'nous' ? 'actif' : ''}`} onClick={() => setCamp('nous')}>{donnees.match.equipe_nom}</button>
        <button style={{ minHeight: 64, minWidth: 180, fontSize: '1.15rem' }} className={`adversaire ${camp === 'adversaire' ? 'actif' : ''}`} onClick={() => setCamp('adversaire')}>{donnees.match.adversaire_nom ?? 'Adversaire'}</button>
      </div>
      <div className="boutons">
        {types.map((t) => <button key={t.key} onClick={() => appuyer(t)} style={{ borderColor: camp === 'nous' ? 'var(--nous)' : 'var(--adv)' }}>{t.label}</button>)}
      </div>
      {dernier && typeDernier && (
        <div className="carte pile">
          <div className="ligne entre"><strong>Compléter (facultatif) : {typeDernier.label} à {formatTimecode(dernier.debut)}</strong>
            <button className="bouton danger" onClick={() => { void ecrire({ ...dernier, supprime: true }); setDernier(null); }}>Annuler cette action</button></div>
          {typeDernier.resultats.length > 1 && (
            <div className="boutons">
              {typeDernier.resultats.map((r) => (
                <button key={r.value} style={{ minHeight: 64, fontSize: '1rem', background: dernier.resultat === r.value ? 'var(--primaire)' : undefined, color: dernier.resultat === r.value ? '#fff' : undefined }}
                  onClick={() => completer({ resultat: r.value })}>{r.label}</button>
              ))}
            </div>
          )}
          <div className="compo-mini" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
            {(dernier.camp === 'nous' && feuille.length ? feuille.map((f) => f.numero) : Array.from({ length: 23 }, (_, i) => i + 1)).map((n: number) => (
              <button key={n} style={{ minHeight: 52, fontSize: '1.1rem' }} className={numero === String(n) ? 'actif' : ''} onClick={() => choisirNumero(String(n))}>{n}</button>
            ))}
          </div>
        </div>
      )}
      <div className="carte">
        <h3>Dernières actions ({liste.length})</h3>
        <div className="liste-ev" style={{ maxHeight: 280 }}>
          {liste.slice(0, 30).map((e) => (
            <div key={e.id} className={`ev-ligne ${e.camp} ${e.aCompleter ? 'a-completer' : ''}`}>
              <span>{formatTimecode(e.debut)}</span>
              <span>{types.find((t) => t.key === e.typeKey)?.label} {e.resultat ? types.find((t) => t.key === e.typeKey)?.resultats.find((r) => r.value === e.resultat)?.label : ''}</span>
              <span>{e.aCompleter ? 'à compléter' : '✓'}</span>
            </div>
          ))}
        </div>
        <p className="muet petit">Après le match : téléversez la vidéo, placez les deux coups d'envoi dans l'écran de codage et utilisez « Recaler les actions live » pour les aligner sur la vidéo.</p>
      </div>
    </div>
  );
}
