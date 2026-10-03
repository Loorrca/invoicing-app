// Recherche tolerante arabe <-> latin, pour retrouver un client quelle que
// soit la graphie tapee : "بلدية التضامن" doit ressortir en tapant "tadhamen"
// OU "tadamen", "المستشفى المحلي بقلعة سنان" en tapant "sinan", etc.
//
// Le coeur de l'algorithme (squelette consonantique : on ramene un mot a ses
// consonnes, en neutralisant voyelles/redoublements/variantes k-q-g-s-c-ch)
// est un port fidele de electron/lib/translitteration.js, deja utilise en
// production pour rapprocher les factures des libelles bancaires BIAT. Pas
// d'IA : juste de la normalisation de caracteres.
//
// Seule difference volontaire avec la version "rapprochement bancaire" :
// celle-ci exclut les mots administratifs (commune, hopital, centre...) de
// la comparaison, car ils n'aident pas a identifier UN client precis parmi
// un releve. Ici, a l'inverse, on VEUT pouvoir taper "hopital" et retrouver
// tous les clients dont le nom contient ce mot — donc aucun mot n'est traite
// comme bruit : chaque mot du nom reste cherchable.

const ARABE = {
  "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ٱ": "a", "ى": "a",
  "ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "k",
  "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "s",
  "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "k",
  "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n",
  "ه": "h", "ة": "h", "و": "w", "ي": "y", "ئ": "y", "ؤ": "w",
  "ء": "", "ّ": "", "َ": "", "ُ": "", "ِ": "", "ْ": "", "ً": "",
  "ٌ": "", "ٍ": "", "ـ": "",
};

const EST_ARABE = /[؀-ۿ]/;

function arabeVersLatin(mot) {
  if (mot.startsWith("ال") && mot.length > 3) mot = mot.slice(2); // article defini
  return [...mot].map((c) => (c in ARABE ? ARABE[c] : c)).join("");
}

const DIGRAMMES = [
  ["tch", "j"], ["sch", "s"], ["kh", "k"], ["gh", "k"], ["ph", "f"],
  ["th", "t"], ["dh", "d"], ["ch", "s"], ["sh", "s"], ["dj", "j"],
  ["ou", "u"], ["qu", "k"], ["ck", "k"],
];

function latinNeutre(mot) {
  mot = mot.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [avant, apres] of DIGRAMMES) mot = mot.split(avant).join(apres);
  mot = mot.replace(/c(?=[eiy])/g, "s");
  mot = mot.replaceAll("c", "k").replaceAll("q", "k").replaceAll("g", "k");
  mot = mot.replaceAll("x", "ks");
  return mot;
}

const VOYELLES_RE = /[aeiouwy'`\-_.]/g;

/** Reduit un mot a ses consonnes, quelle que soit sa graphie d'origine. */
export function squelette(mot) {
  if (!mot) return "";
  if (EST_ARABE.test(mot)) mot = arabeVersLatin(mot);
  mot = latinNeutre(mot);
  mot = mot.replace(VOYELLES_RE, "");
  mot = mot.replace(/(.)\1+/g, "$1"); // redoublements
  if (mot.length > 2 && mot.endsWith("h")) mot = mot.slice(0, -1); // ta marbouta / -a final
  return mot;
}

/** Squelettes (>=2 consonnes) de chaque mot significatif d'un texte. Aucun
 *  mot n'est exclu ici (contrairement au rapprochement bancaire) : c'est
 *  justement les mots "administratifs" qu'on veut pouvoir chercher. */
function squelettesMots(texte) {
  if (!texte) return [];
  const mots = texte.split(/[^\w؀-ۿ]+/).filter(Boolean);
  const out = [];
  for (const mot of mots) {
    if (/^\d+$/.test(mot)) continue;
    const s = squelette(mot);
    if (s.length >= 2) out.push(s);
  }
  return out;
}

// La translitteration seule a une limite : "hopital" et "مستشفى" sont deux
// MOTS DIFFERENTS qui veulent dire la meme chose (une traduction, pas une
// transcription du meme son) — aucun algorithme de squelette phonetique ne
// peut les rapprocher, contrairement a "Sinan"/"سنان" qui sont la meme
// prononciation ecrite dans deux alphabets. Pour couvrir ce cas, on ajoute un
// petit lexique explicite des mots administratifs les plus frequents dans
// les noms de clients institutionnels tunisiens. Toujours zero IA : une
// simple table de correspondance figee.
const SYNONYMES = [
  ["commune", "بلدية"], ["municipalite", "بلدية"],
  ["gouvernorat", "ولاية"],
  ["ministere", "وزارة"],
  ["hopital", "مستشفى"], ["hopital", "مستوصف"], ["clinique", "عيادة"],
  ["ecole", "مدرسة"], ["universite", "جامعة"], ["institut", "معهد"],
  ["faculte", "كلية"], ["lycee", "معهد"],
  ["direction", "مديرية"], ["office", "ديوان"],
  ["societe", "شركة"], ["entreprise", "شركة"],
  ["agence", "وكالة"], ["association", "جمعية"], ["etablissement", "مؤسسة"],
  ["banque", "بنك"], ["poste", "بريد"], ["douane", "ديوانة"],
  ["prison", "سجن"], ["tribunal", "محكمة"], ["caisse", "صندوق"],
  ["centre", "مركز"], ["medical", "طبي"], ["sante", "صحة"],
  ["national", "وطني"], ["regional", "جهوي"],
];

/** squelette(mot latin) -> Set de squelette(mot arabe equivalent), et
 *  inversement — construit une seule fois au chargement du module. */
const EQUIVALENTS = new Map();
function ajouterEquivalence(a, b) {
  if (!EQUIVALENTS.has(a)) EQUIVALENTS.set(a, new Set());
  EQUIVALENTS.get(a).add(b);
}
for (const [latin, arabe] of SYNONYMES) {
  const sl = squelette(latin);
  const sa = squelette(arabe);
  if (sl && sa) {
    ajouterEquivalence(sl, sa);
    ajouterEquivalence(sa, sl);
  }
}

function sontEquivalents(a, b) {
  if (a.includes(b) || b.includes(a)) return true;
  const eq = EQUIVALENTS.get(a);
  return eq ? eq.has(b) : false;
}

/** Le nom du client correspond-il a la requete tapee (eventuellement en
 *  graphie differente, voire en traduction pour les mots administratifs
 *  courants) ? Chaque mot de la requete doit se retrouver dans au moins un
 *  mot du nom, pour un resultat qui se met a jour au fur et a mesure de la
 *  frappe, comme une recherche normale. Une requete vide correspond a tout
 *  (coherent avec le filtre existant). */
export function correspondTranslitteration(nomClient, requete) {
  const motsRequete = squelettesMots(requete);
  if (motsRequete.length === 0) return true;
  const motsClient = squelettesMots(nomClient);
  if (motsClient.length === 0) return false;
  return motsRequete.every((mr) => motsClient.some((mc) => sontEquivalents(mc, mr)));
}

// Un sigle comme "O.N.P.F.T" est fait de lettres isolees separees par des
// points : la recherche normale (substring) echoue car "o.n.p.f.t" ne
// contient pas "onpft", et meme la recherche translitteree ci-dessus les
// ignore (chaque lettre seule est un "mot" d'une seule consonne, trop court
// pour etre indexe). Ce n'est pas un probleme de translitteration arabe/latin
// — juste de ponctuation — donc on le traite a part : on retire toute la
// ponctuation/les espaces des deux cotes et on compare ce qui reste.
function compact(texte) {
  return (texte || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
}

/** Variante "sigle" : ignore la ponctuation (points, espaces...) plutot que
 *  de la traiter comme un separateur de mots. Complete correspondTranslitteration
 *  ci-dessus plutot que de le remplacer. */
export function correspondSigle(nomClient, requete) {
  const r = compact(requete);
  if (!r) return true;
  return compact(nomClient).includes(r);
}
