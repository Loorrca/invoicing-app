"use strict";

/**
 * Retenue a la source : ce qui explique qu'un virement recu soit legerement
 * inferieur au montant TTC de la facture.
 *
 * Sur un marche public tunisien, le comptable public retient :
 *   - 1 % du montant T.T.C.             (retenue a la source "classique")
 *   - 25 % de la T.V.A.                 (retenue a la source sur la TVA)
 *
 * Le calcul correct assoit cette seconde retenue sur T.V.A. + FODEC ; beaucoup
 * de services payeurs se trompent et ne retiennent que 25 % de la T.V.A. seule.
 * L'ecart entre les deux vaut 25 % du FODEC, soit quelques dinars. On ne peut
 * donc pas chercher un montant exact : on cherche dans une fourchette, en
 * gardant la trace de la variante qui colle.
 *
 * Certaines recettes des finances appliquent un taux de 1,5 % sur le TTC (au
 * lieu de 1 %) tout en gardant les 25 % de TVA seule — confirme a l'identique
 * sur plusieurs paiements reels (ex. factures TEXBANNER 0001 et 0049).
 *
 * Port fidele de invoice-tracker/invoice_tracker/retenue.py.
 */

const TAUX_RS_TTC = 0.01; // 1 % du TTC
const TAUX_RS_TTC_MAJORE = 0.015; // variante 1,5 % constatee chez certaines recettes des finances
const TAUX_RS_TVA = 0.25; // 25 % de la TVA (+ FODEC selon la variante)

// Un reglement peut etre arrondi au dinar superieur *a l'interieur* de la
// fourchette des retenues, mais il ne depasse jamais le TTC : une retenue ne
// fait que retrancher. Sans cette borne, un virement de 120,190 pouvait etre
// impute a une facture de 120,000.
const MARGE_SUPERIEURE = 0.05;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {number} ttc
 * @param {number|null|undefined} tva
 * @param {number|null|undefined} fodec
 * @returns {{montant:number, code:string, libelle:string}[]} du plus eleve au plus faible
 */
function variantes(ttc, tva, fodec) {
  tva = tva || 0;
  fodec = fodec || 0;

  const rsTtc = round3(ttc * TAUX_RS_TTC);
  const rsTtcMajore = round3(ttc * TAUX_RS_TTC_MAJORE);
  const rsTvaSeule = round3(tva * TAUX_RS_TVA);
  const rsTvaFodec = round3((tva + fodec) * TAUX_RS_TVA);

  const brut = [
    { montant: ttc, code: "AUCUNE", libelle: "payé au montant TTC, sans retenue" },
    { montant: ttc - rsTtc, code: "RS1", libelle: "retenue 1 % TTC seulement" },
    { montant: ttc - rsTvaSeule, code: "RSTVA", libelle: "retenue 25 % TVA seulement" },
    { montant: ttc - rsTvaFodec, code: "RSTVAF", libelle: "retenue 25 % (TVA + FODEC) seulement" },
    {
      montant: ttc - rsTtc - rsTvaSeule,
      code: "RS1_TVA",
      libelle: "retenue 1 % TTC + 25 % TVA (FODEC oublié)",
    },
    {
      montant: ttc - rsTtc - rsTvaFodec,
      code: "RS1_TVAF",
      libelle: "retenue 1 % TTC + 25 % (TVA + FODEC) — calcul complet",
    },
    {
      montant: ttc - rsTtcMajore - rsTvaSeule,
      code: "RS15_TVA",
      libelle: "retenue 1,5 % TTC + 25 % TVA (FODEC oublié, taux 1,5 %)",
    },
  ];

  // dedoublonnage (sans FODEC, plusieurs variantes coincident)
  const vues = new Map();
  for (const v of brut) {
    const cle = round3(v.montant);
    if (!vues.has(cle)) vues.set(cle, { montant: cle, code: v.code, libelle: v.libelle });
  }
  return [...vues.values()].sort((a, b) => b.montant - a.montant);
}

/**
 * Bornes (min, max) dans lesquelles un reglement de cette facture doit tomber.
 * `tolerance` (en dinars) absorbe les arrondis du comptable public vers le bas.
 * Vers le haut, la borne reste le montant TTC + une petite marge.
 */
function fourchette(ttc, tva, fodec, tolerance = 0.5) {
  const tous = variantes(ttc, tva, fodec);
  const bas = Math.min(...tous.map((v) => v.montant));
  const haut = Math.max(...tous.map((v) => v.montant));
  return [round3(bas - tolerance), round3(haut + MARGE_SUPERIEURE)];
}

/**
 * Quelle variante de retenue explique `montantRecu` ?
 * Retourne { variante, ecart }. `variante` vaut null si le montant recu ne
 * tombe dans aucune variante connue a `tolerance` pres.
 */
function identifier(ttc, tva, fodec, montantRecu, tolerance = 0.5) {
  let meilleure = null;
  let meilleurEcart = Infinity;
  for (const v of variantes(ttc, tva, fodec)) {
    const ecart = Math.abs(v.montant - montantRecu);
    if (ecart < meilleurEcart) {
      meilleure = v;
      meilleurEcart = ecart;
    }
  }
  if (meilleure !== null && meilleurEcart <= tolerance) {
    return { variante: meilleure, ecart: round3(meilleurEcart) };
  }
  return { variante: null, ecart: round3(meilleurEcart) };
}

module.exports = {
  variantes,
  fourchette,
  identifier,
  TAUX_RS_TTC,
  TAUX_RS_TTC_MAJORE,
  TAUX_RS_TVA,
  MARGE_SUPERIEURE,
};
