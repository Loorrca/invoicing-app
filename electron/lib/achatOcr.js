"use strict";

// OCR "au mieux" pour deviner le montant total d'une facture fournisseur
// photographiee au telephone (voir mobile/ pour la capture, electron/achats.js
// pour le stockage). Tourne sur le poste de bureau (pas sur le telephone,
// choix explicite de l'utilisateur) via tesseract.js, en pur JS/WASM, sans
// dependance native a compiler.
//
// Resultat TOUJOURS presente a l'utilisateur pour confirmation/correction
// avant enregistrement (voir Achats.jsx) : une photo de facture papier,
// tampon et ecriture manuelle compris, ne donne jamais une lecture fiable a
// 100%, ce n'est pas le but ici.

// Optionnel : si "npm install" n'a pas encore ete relance pour recuperer
// cette nouvelle dependance, l'analyse renvoie juste "aucun montant devine"
// plutot que de faire planter l'appli (meme principe que pdf-lib/
// electron-updater dans main.js).
let createWorker = null;
try {
  ({ createWorker } = require("tesseract.js"));
} catch {
  // voir analyserImageAchat ci-dessous
}

// Mots-cles (sans accents, en minuscules) qui introduisent generalement le
// montant final sur une facture/un ticket tunisien, par ordre de priorite
// (le premier trouve l'emporte). "net a payer" avant "total" : sur une
// facture avec remise/timbre fiscal, le "net a payer" est le vrai montant
// final, le "total" seul peut n'etre qu'un sous-total.
const MOTS_CLES_PRIORITE = [
  "net a payer",
  "net payer",
  "montant net a payer",
  "total ttc",
  "total a payer",
  "montant total ttc",
  "montant total",
  "total general",
  "total net",
];

function sansAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Convertit un nombre ecrit "a la tunisienne/francaise" (espace ou point en
// separateur de milliers, virgule en separateur decimal - ex. "1 234,500"
// ou "1.234,500") en Number JS. Tolere aussi le format international
// ("1234.500") si c'est la seule forme rencontree sur la ligne.
function parserNombre(brut) {
  let s = String(brut || "").trim();
  if (!s) return null;
  const aVirgule = s.includes(",");
  const aPoint = s.includes(".");
  if (aVirgule && aPoint) {
    // Le dernier des deux est le separateur decimal, l'autre le separateur
    // de milliers (ex. "1.234,500" -> decimal = virgule).
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (aVirgule) {
    s = s.replace(/\s/g, "").replace(",", ".");
  } else {
    s = s.replace(/\s/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Tous les nombres "montant-like" (avec ou sans decimales) d'une ligne.
const RE_NOMBRE = /\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?/g;

function nombresDansLigne(ligne) {
  const trouves = ligne.match(RE_NOMBRE) || [];
  return trouves.map(parserNombre).filter((n) => n !== null && n > 0);
}

// Uniquement les nombres AVEC decimales (ex. "197,945" mais pas "98619811").
// Un numero de telephone, un matricule fiscal ou un numero de facture sont
// des suites de chiffres SANS virgule/point decimal : les exclure ainsi
// evite de les confondre avec un montant (bug observe : un numero de
// telephone pris pour le plus gros montant de la page).
const RE_NOMBRE_DECIMAL = /\d{1,3}(?:[ .]\d{3})*[.,]\d{1,3}/g;

function nombresDecimauxDansLigne(ligne) {
  const trouves = ligne.match(RE_NOMBRE_DECIMAL) || [];
  return trouves.map(parserNombre).filter((n) => n !== null && n > 0);
}

// --------------------------------------------------------------------------
// Montant en toutes lettres (ex. "cent quatre vingt dix sept dinars neuf
// cent quarante cinq millimes") - demande explicite de l'utilisateur : une
// facture tunisienne porte presque toujours aussi son montant ecrit en
// toutes lettres ("Arretee la presente facture a la somme de : ..."), un
// texte qui ne peut pas etre confondu avec un numero de telephone, une date
// ou un matricule fiscal comme peut l'etre une suite de chiffres imprimes -
// voir le bug ci-dessus. Verifie EN PREMIER, avant toute lecture de
// chiffres, des que l'OCR est assez propre pour la reconnaitre.
// --------------------------------------------------------------------------

const MOTS_NOMBRES = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

// Normalise un segment de texte en liste de mots (minuscules, sans accents,
// tirets traites comme des espaces, tout ce qui n'est pas une lettre retire).
function nettoyerMots(segment) {
  return sansAccents(segment)
    .replace(/-/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Seuls "cent(s)" et "vingt(s)" prennent un "s" au pluriel parmi les
// mots-nombres (ex. "quatre-vingts", "trois cents") : un simple retrait du
// "s" final sur TOUT mot casserait "trois" (3) en "troi", qui n'est reconnu
// nulle part. On ne normalise donc que ces deux-la, explicitement.
function normaliserMotNombre(mot) {
  if (mot === "cents") return "cent";
  if (mot === "vingts") return "vingt";
  return mot;
}

// Convertit une suite de mots-nombres francais en valeur entiere, ou null si
// aucun mot-nombre reconnu n'a ete trouve dans la suite (un mot inconnu,
// bruit d'OCR ou mot de liaison, est simplement ignore plutot que de faire
// echouer tout le parsing). Couvre 0-999999, largement suffisant ici (un
// montant d'achat de matieres premieres ne depasse pas quelques milliers de
// dinars).
function motsVersNombre(mots) {
  let total = 0;
  let groupe = 0;
  let trouve = false;

  for (let i = 0; i < mots.length; i++) {
    const mot = normaliserMotNombre(mots[i]);
    if (mot === "et" || !mot) continue;

    // "quatre-vingt(s)" = 4 x 20 = 80 (seul cas multiplicatif parmi les
    // dizaines ; "soixante-dix" etc. sont de simples additions, deja
    // couvertes par la boucle normale : soixante(60) + dix(10) = 70).
    const suivant = mots[i + 1] ? normaliserMotNombre(mots[i + 1]) : null;
    if (mot === "quatre" && suivant === "vingt") {
      groupe += 80;
      i++;
      trouve = true;
      continue;
    }

    if (mot in MOTS_NOMBRES) {
      groupe += MOTS_NOMBRES[mot];
      trouve = true;
      continue;
    }
    if (mot === "cent") {
      groupe = (groupe || 1) * 100;
      trouve = true;
      continue;
    }
    if (mot === "mille" || mot === "mil") {
      total += (groupe || 1) * 1000;
      groupe = 0;
      trouve = true;
      continue;
    }
    // Mot non reconnu ("dinars", "virgule", bruit OCR...) : ignore.
  }

  if (!trouve) return null;
  return total + groupe;
}

// Cherche un montant ecrit en toutes lettres autour du mot "dinar(s)" dans
// le texte OCR complet, et le convertit en valeur numerique (dinars +
// millimes/1000). Renvoie null si aucun "dinar(s)" trouve, ou si les mots
// juste avant ne forment pas un nombre reconnu.
function montantDepuisLettres(texteOcr) {
  const texte = sansAccents(texteOcr).replace(/-/g, " ");
  const matchDinar = texte.match(/dinars?/);
  if (!matchDinar) return null;

  const indexDinar = matchDinar.index;
  // Une dizaine de mots avant "dinar(s)" suffit largement a couvrir meme un
  // montant de plusieurs milliers de dinars ecrit en toutes lettres, sans
  // risquer de remonter jusqu'a des chiffres sans rapport plus haut dans le
  // texte (en-tete, numero de facture...).
  const avant = nettoyerMots(texte.slice(Math.max(0, indexDinar - 120), indexDinar)).slice(-12);
  const dinars = motsVersNombre(avant);
  if (dinars === null) return null;

  let millimes = 0;
  const apres = texte.slice(matchDinar.index + matchDinar[0].length, matchDinar.index + matchDinar[0].length + 120);
  const matchMillime = apres.match(/millimes?/);
  if (matchMillime) {
    const segment = apres.slice(0, matchMillime.index);
    // Les millimes sont parfois imprimes en chiffres plutot qu'en toutes
    // lettres (ex. "... Dinars 945 Millimes") : on essaie d'abord cette
    // lecture, plus fiable quand elle est disponible.
    const enChiffres = segment.match(/\d+/);
    if (enChiffres) {
      millimes = parseInt(enChiffres[0], 10);
    } else {
      const valeur = motsVersNombre(nettoyerMots(segment));
      if (valeur !== null) millimes = valeur;
    }
  }

  return dinars + millimes / 1000;
}

// Applique l'heuristique complete de devinette sur le texte brut reconnu
// par l'OCR, par ordre de confiance decroissant : montant en toutes lettres
// (le plus fiable) > ligne contenant un mot-cle de total > plus gros
// montant AVEC decimales trouve sur la page (jamais un entier brut, pour ne
// pas prendre un numero de telephone ou un matricule pour un montant).
// Exporte separement de analyserImageAchat pour pouvoir etre teste sans
// dependre de tesseract.js (texte OCR simule en entree).
function deviterMontant(texteOcr) {
  const enLettres = montantDepuisLettres(texteOcr);
  if (enLettres !== null && enLettres > 0) return enLettres;

  const lignes = String(texteOcr || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const motCle of MOTS_CLES_PRIORITE) {
    for (const ligne of lignes) {
      if (sansAccents(ligne).includes(motCle)) {
        const decimaux = nombresDecimauxDansLigne(ligne);
        if (decimaux.length > 0) return decimaux[decimaux.length - 1];
        const tousNombres = nombresDansLigne(ligne);
        if (tousNombres.length > 0) return tousNombres[tousNombres.length - 1];
      }
    }
  }

  let max = null;
  for (const ligne of lignes) {
    for (const n of nombresDecimauxDansLigne(ligne)) {
      if (max === null || n > max) max = n;
    }
  }
  return max;
}

// `image` : Buffer (voir driveSync.telechargerFichierBinaire). Renvoie
// { texteOcr, montantDevine } — montantDevine peut etre null (rien trouve,
// ou tesseract.js non installe), jamais une erreur bloquante : l'utilisateur
// saisit alors le montant a la main.
async function analyserImageAchat(image) {
  if (!createWorker) return { texteOcr: "", montantDevine: null };
  const worker = await createWorker("fra");
  try {
    const {
      data: { text },
    } = await worker.recognize(image);
    return { texteOcr: text || "", montantDevine: deviterMontant(text) };
  } finally {
    await worker.terminate();
  }
}

module.exports = { analyserImageAchat, deviterMontant, montantDepuisLettres, motsVersNombre };
