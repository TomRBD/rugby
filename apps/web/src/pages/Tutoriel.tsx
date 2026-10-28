// Tutoriel intégré : prise en main d'un bénévole en moins de 30 minutes.
import { Link } from 'react-router-dom';
import { TAXONOMIE_DEFAUT, typesParNiveau } from '@rugby/shared';

export default function Tutoriel() {
  const express = typesParNiveau(TAXONOMIE_DEFAUT, 'express');
  return (
    <div className="pile" style={{ maxWidth: 900 }}>
      <h1>Prise en main en 30 minutes</h1>
      <p className="muet">Suivez ces étapes dans l'ordre. Un match de démonstration déjà codé est disponible pour vous entraîner (commande <code>npm run seed:demo</code>, compte demo@rugby-analyse.fr).</p>
      <ol className="etapes">
        <li className="carte"><h3>1. Créer l'équipe et l'effectif (5 min)</h3>
          <p>Dans <Link to="/equipes">Équipes et saisons</Link>, créez votre équipe. Ajoutez les joueurs dans <Link to="/effectif">Effectif</Link> avec leur numéro habituel, puis cliquez « Composer l'effectif » sur l'équipe.</p></li>
        <li className="carte"><h3>2. Créer le match et la feuille (3 min)</h3>
          <p>Dans <Link to="/matchs?nouveau=1">Matchs</Link>, créez le match. Sur sa page, « Pré-remplir » place chaque joueur disponible à son numéro habituel. Ajustez, puis enregistrez. Les remplacements et cartons se saisissent avec la minute : le temps de jeu est calculé seul.</p></li>
        <li className="carte"><h3>3. Envoyer la vidéo (2 min, puis en tâche de fond)</h3>
          <p>Onglet Vidéo : sélectionnez tous les fichiers de la carte SD en une fois. L'envoi reprend tout seul après une coupure et vous pouvez continuer à travailler. Le traitement serveur produit les versions 1080p, 720p et 480p.</p></li>
        <li className="carte"><h3>4. Placer les deux coups d'envoi (1 min)</h3>
          <p>Dans l'écran de codage, avancez jusqu'au coup d'envoi et cliquez « Coup d'envoi 1re MT ici ». Même chose en 2e mi-temps. L'IA (offre Club+) peut vous les proposer automatiquement grâce au sifflet.</p></li>
        <li className="carte"><h3>5. Coder en Express (45 min pour un match)</h3>
          <p>Lancez la vidéo (Espace). À chaque action, appuyez sur sa touche : la vidéo se met en pause. Tapez le chiffre du résultat, puis le numéro du joueur, puis Entrée : la lecture reprend. Tab change d'équipe.</p>
          <div className="boutons-codage">{express.map((t) => <div key={t.key} className="bouton-ev"><strong>{t.label}</strong>{t.raccourci && <kbd>{t.raccourci.toUpperCase()}</kbd>}</div>)}</div>
          <p className="petit muet">Astuces : D duplique la dernière action, Ctrl+Z l'annule, [ et ] changent la vitesse, la saisie vocale comprend « plaquage manqué 7 ».</p></li>
        <li className="carte"><h3>6. Lire les statistiques (5 min)</h3>
          <p>Onglet Statistiques : chaque chiffre souligné ouvre les clips qui le composent. Les objectifs du match apparaissent en vert ou rouge. Le rapport PDF se génère en un clic.</p></li>
        <li className="carte"><h3>7. Partager aux joueurs</h3>
          <p>Depuis un clip ou un filtre, créez une playlist, faites-la valider par l'entraîneur principal puis partagez-la : chaque joueur reçoit un lien personnel (filigrane à son nom) lisible sur téléphone, et vous voyez qui l'a regardée.</p></li>
        <li className="carte"><h3>Au bord du terrain : codage live</h3>
          <p>Sur tablette, ouvrez « Codage live » depuis la page du match avant le coup d'envoi (pour le mettre en cache). Tout fonctionne sans réseau ; les actions se synchronisent au retour du réseau puis se recalent sur la vidéo.</p></li>
      </ol>
    </div>
  );
}
