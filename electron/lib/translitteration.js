"use strict";

/**
 * Pont arabe <-> latin pour reconnaitre un client dans un libelle bancaire.
 *
 * Les factures nomment parfois le client en arabe ("بلدية المنيهلة"), alors
 * que le releve BIAT ecrit le donneur d'ordre en caracteres latins ("COMMUNE
 * MNIHLA", "BALADIA MENIHLA", "COM. EL MNIHLA"...). Une comparaison directe ne
 * peut jamais aboutir.
 *
 * La solution retenue est le squelette consonantique : on ramene les deux
 * graphies a leurs consonnes, en neutralisant ce qui varie d'une
 * translitteration a l'autre (voyelles, redoublements, k/q/g, s/c/ch).
 *
 *   بلدية المنيهلة  ->  {bld, mnhl}
 *   COMMUNE MNIHLA  ->  {kmn, mnhl}      -> "mnhl" commun
 *
 * Ce n'est pas de la translitteration exacte : c'est volontairement grossier,
 * pour absorber les variantes d'orthographe. Port fidele de
 * invoice-tracker/invoice_tracker/translitteration.py.
 */

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
function squelette(mot) {
  if (!mot) return "";
  if (EST_ARABE.test(mot)) mot = arabeVersLatin(mot);
  mot = latinNeutre(mot);
  mot = mot.replace(VOYELLES_RE, "");
  mot = mot.replace(/(.)\1+/g, "$1"); // redoublements
  if (mot.length > 2 && mot.endsWith("h")) mot = mot.slice(0, -1); // ta marbouta / -a final
  return mot;
}

// Mots administratifs : presents dans presque tous les noms, donc sans valeur
// discriminante.
const VIDES_BRUTS = [
  "commune", "com", "municipalite", "baladia", "ville",
  "gouvernorat", "gouvernerat", "wilaya", "delegation", "direction",
  "ministere", "republique", "tunisie", "tunisienne", "tunisien",
  "institut", "superieur", "ecole", "faculte", "universite", "lycee",
  "hopital", "centre", "medical", "office", "national", "regional",
  "societe", "entreprise", "agence", "association", "etablissement",
  "public", "general", "service", "affaires", "bureau", "prison",
  "بلدية", "ولاية", "المندوبية", "الجهوية", "لشؤون", "المعهد", "العالي",
  "المركز", "مركز", "كلية", "دار", "جمعية", "مكتب", "سجن", "المستشفى",
  "الجامعي", "المدرسي", "الوطني", "الديوان", "وزارة", "ادارة", "معهد",
];
const VIDES = new Set([...VIDES_BRUTS.map(squelette), ""]);

/** Squelettes significatifs d'un nom de client ou d'un libelle bancaire. */
function squelettes(texte) {
  if (!texte) return new Set();
  const mots = texte.split(/[^\w؀-ۿ]+/);
  const out = new Set();
  for (const mot of mots) {
    if (!mot || /^\d+$/.test(mot)) continue;
    const s = squelette(mot);
    if (s.length >= 2 && !VIDES.has(s)) out.add(s);
  }
  return out;
}

/** Squelettes communs au nom du client et au libelle bancaire. */
function correspondance(client, libelle) {
  const a = squelettes(client);
  const b = squelettes(libelle);
  const communs = new Set([...a].filter((x) => b.has(x)));

  // Tolerance : l'arabe agglutine les prepositions au nom propre, et le
  // libelle bancaire tronque parfois le nom. On accepte donc qu'un squelette
  // soit contenu dans l'autre, a deux consonnes pres.
  for (const x of a) {
    if (communs.has(x)) continue;
    for (const y of b) {
      const [court, long_] = x.length <= y.length ? [x, y] : [y, x];
      if (court.length >= 2 && long_.length - court.length <= 2 && long_.includes(court)) {
        communs.add(x);
        break;
      }
    }
  }
  return communs;
}

module.exports = { squelette, squelettes, correspondance };
