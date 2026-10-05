// Taux fiscaux tunisiens actuels, en UN SEUL endroit cote renderer : TVA
// 19%, FODEC 1% (optionnel par facture, voir avecFodec). Consomme par
// NewInvoice.jsx (formulaire + apercu) et Calculatrice.jsx (convertisseur
// P.H.T / P.T.T.C).
//
// Si une loi de finances change un jour ces taux, modifier UNIQUEMENT ce
// fichier suffit pour tout ce qui tourne cote renderer. Equivalent cote
// Electron : electron/lib/taxRates.js — duplique a l'identique pour la meme
// raison que calculerTotaux (contrainte Electron main/renderer, deux
// systemes de modules differents ; voir le commentaire au-dessus de
// calculerTotaux dans NewInvoice.jsx). En cas de changement de taux,
// modifier les DEUX fichiers (src/utils/taxRates.js et
// electron/lib/taxRates.js) avec la meme valeur.
export const TAUX_TVA = 0.19;
export const TAUX_FODEC = 0.01;
