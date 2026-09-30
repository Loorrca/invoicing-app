"use strict";

// Calcul des totaux d'une facture, partage par tous les gabarits PDF (et par
// l'interface, cote Nouvelle facture / Modifier). Reste independant du
// gabarit choisi : deux entreprises avec des gabarits differents doivent
// obtenir exactement les memes totaux pour les memes lignes.

/**
 * Calcule HT / Fodec / TVA / TTC a partir des lignes de la facture.
 * @param {{quantite:number, prixUnitaire:number}[]} lignes
 * @param {boolean} avecFodec
 */
function calculerTotaux(lignes, avecFodec) {
  const ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), 0);
  const fodec = avecFodec ? ht * 0.01 : 0;
  const tva = (ht + fodec) * 0.19;
  const ttc = ht + fodec + tva;
  const arrondir = (n) => Math.round(n * 1000) / 1000;
  return { ht: arrondir(ht), fodec: arrondir(fodec), tva: arrondir(tva), ttc: arrondir(ttc) };
}

module.exports = { calculerTotaux };
