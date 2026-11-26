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

// Trouve tous les nombres "montant-like" (au moins un chiffre, eventuellement
// groupe par milliers, avec ou sans decimales) dans une ligne de texte OCR.
const RE_NOMBRE = /\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?/g;

function nombresDansLigne(ligne) {
  const trouves = ligne.match(RE_NOMBRE) || [];
  return trouves.map(parserNombre).filter((n) => n !== null && n > 0);
}

// Applique l'heuristique de devinette sur le texte brut reconnu par l'OCR.
// Exporte separement de analyserImageAchat pour pouvoir etre teste sans
// dependre de tesseract.js (texte OCR simule en entree).
function deviterMontant(texteOcr) {
  const lignes = String(texteOcr || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const motCle of MOTS_CLES_PRIORITE) {
    for (const ligne of lignes) {
      if (sansAccents(ligne).includes(motCle)) {
        const nombres = nombresDansLigne(ligne);
        if (nombres.length > 0) return nombres[nombres.length - 1];
      }
    }
  }

  // Aucun mot-cle trouve : a defaut, le plus grand montant repere sur
  // l'ensemble du ticket est la meilleure devinette disponible (le total
  // depasse presque toujours chaque ligne/sous-total pris individuellement).
  let max = null;
  for (const ligne of lignes) {
    for (const n of nombresDansLigne(ligne)) {
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

module.exports = { analyserImageAchat, deviterMontant };
