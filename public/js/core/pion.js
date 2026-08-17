// public/js/core/pion.js
//
// Composant transversal : rendu visuel du "Pion" (identité joueur),
// destiné à tous les jeux, au scoreboard global et à la navigation.
//
// Renommé depuis "jeton" : ce mot est déjà pris dans le code pour les
// pièces de jeu elles-mêmes (.p4-jeton / .p4-jeton-pose / .p4-jeton-gagnant
// pour le disque Puissance 4, .jeton-equipe / .jetons-bloquage pour le
// blocage Morpion). "Pion" désigne uniquement l'identité du joueur.
//
// RÈGLE D'ARCHITECTURE :
// La couleur de pion d'un joueur est une donnée SERVEUR (store.js),
// transmise via le snapshot WS. Ce module ne fait qu'afficher une couleur
// reçue — il n'assigne, ne devine, ni ne mémorise aucune couleur en local.
// Aucune nouvelle source de vérité côté client.

export const PION_PALETTE = Object.freeze([
  { id: 'rouge', hex: '#D6484F', label: 'Rouge' },
  { id: 'bleu', hex: '#2C6E9E', label: 'Bleu' },
  { id: 'safran', hex: '#D97B29', label: 'Safran' },
  { id: 'prairie', hex: '#5FA777', label: 'Prairie' },
  { id: 'violet', hex: '#7C5CA8', label: 'Violet' },
  { id: 'turquoise', hex: '#3E9C93', label: 'Turquoise' }
]);

const FALLBACK_HEX = '#5A5142';

export function getPionCouleur(id) {
  return PION_PALETTE.find(c => c.id === id) || null;
}

/**
 * Couleur déterministe dérivée du pseudo — PAS une donnée serveur.
 * Différent du principe ci-dessus : aucune assignation de couleur n'existe
 * encore côté store.js (Option 1 du handoff jamais câblée). En attendant,
 * ce hash pur produit la MÊME couleur pour le MÊME pseudo, sur l'hôte et
 * chez tous les invités, sans échange réseau ni état à synchroniser —
 * ce n'est donc pas une nouvelle source de vérité, juste une fonction pure
 * du pseudo déjà connu de tous.
 */
export function getPionParPseudo(pseudo) {
  const s = String(pseudo || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PION_PALETTE[h % PION_PALETTE.length];
}

/**
 * Crée l'élément DOM du pion seul (pastille ronde).
 * @param {string} couleurId - id présent dans PION_PALETTE (fourni par le serveur)
 * @param {'s'|'m'|'l'} taille
 */
export function creerPionElement(couleurId, taille = 'm') {
  const couleur = getPionCouleur(couleurId);
  const el = document.createElement('div');
  el.className = `pion pion--${taille}`;
  el.style.background = couleur ? couleur.hex : FALLBACK_HEX;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', couleur ? `Pion ${couleur.label}` : 'Pion inconnu');
  return el;
}

/**
 * Crée un bloc pion + nom du joueur (utilisé dans les lobbys, listes de joueurs).
 */
export function creerPionAvecNom(couleurId, nomJoueur, taille = 'm') {
  const wrap = document.createElement('div');
  wrap.className = 'pion-item';
  wrap.appendChild(creerPionElement(couleurId, taille));
  const span = document.createElement('span');
  span.className = 'pion-item__name';
  span.textContent = nomJoueur;
  wrap.appendChild(span);
  return wrap;
}

/**
 * Crée une ligne de scoreboard : rang, pion, nom, barre de progression, points.
 * `ratio` = score / scoreMax (0 à 1), calculé par l'appelant à partir du snapshot serveur.
 */
export function creerLigneScore({ rang, couleurId, nom, points, ratio }) {
  const row = document.createElement('div');
  row.className = 'sb-row';

  const rankEl = document.createElement('span');
  rankEl.className = 'sb-rank';
  rankEl.textContent = String(rang);
  row.appendChild(rankEl);

  row.appendChild(creerPionElement(couleurId, 's'));

  const nameEl = document.createElement('span');
  nameEl.className = 'sb-name';
  nameEl.textContent = nom;
  row.appendChild(nameEl);

  const barEl = document.createElement('div');
  barEl.className = 'sb-bar';
  const fillEl = document.createElement('div');
  fillEl.className = 'sb-bar__fill';
  fillEl.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  barEl.appendChild(fillEl);
  row.appendChild(barEl);

  const ptsEl = document.createElement('span');
  ptsEl.className = 'sb-pts';
  ptsEl.textContent = `${points} pts`;
  row.appendChild(ptsEl);

  return row;
}

/**
 * Picker de couleur — UI uniquement. Le clic déclenche `onSelect(couleurId)`,
 * charge à l'appelant d'émettre l'action WS correspondante (aucune émission ici).
 * Non câblé pour l'instant — voir Option 1 retenue (attribution automatique
 * serveur) dans le handoff : ce picker reste disponible pour l'Option 2 future.
 */
export function creerPionPicker(onSelect, selectedId = null) {
  const container = document.createElement('div');
  container.className = 'pion-picker';
  PION_PALETTE.forEach(couleur => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pion-pick';
    btn.style.background = couleur.hex;
    btn.setAttribute('aria-pressed', String(couleur.id === selectedId));
    btn.setAttribute('aria-label', `Choisir le pion ${couleur.label}`);
    btn.addEventListener('click', () => onSelect(couleur.id));
    container.appendChild(btn);
  });
  return container;
}