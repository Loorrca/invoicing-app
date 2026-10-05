"use strict";

// Taux fiscaux tunisiens actuels, en UN SEUL endroit cote Electron/main :
// TVA 19%, FODEC 1% (optionnel par facture, voir avecFodec). Consomme par
// electron/lib/invoiceTemplate.js (calcul des totaux ET generation du PDF).
//
// Si une loi de finances change un jour ces taux, modifier UNIQUEMENT ce
// fichier suffit pour tout ce qui tourne cote Electron. Equivalent cote
// renderer : src/utils/taxRates.js — duplique a l'identique pour la meme
// raison que calculerTotaux (contrainte Electron main/renderer, deux
// systemes de modules differents ; voir le commentaire au-dessus de
// calculerTotaux dans invoiceTemplate.js). En cas de changement de taux,
// modifier les DEUX fichiers (electron/lib/taxRates.js et
// src/utils/taxRates.js) avec la meme valeur.
const TAUX_TVA = 0.19;
const TAUX_FODEC = 0.01;

module.exports = { TAUX_TVA, TAUX_FODEC };
