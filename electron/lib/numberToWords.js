"use strict";

/**
 * Convertit un nombre entier (0 .. 999 999 999) en toutes lettres, en
 * francais, sans traits d'union (convention utilisee sur les factures de
 * l'entreprise : "HUIT CENT SOIXANTE DIX HUIT" plutot que
 * "huit-cent-soixante-dix-huit").
 *
 * Suit les regles classiques : "et" devant "un"/"onze" pour les dizaines
 * 20/30/40/50/60, "soixante-dix"/"quatre-vingt-dix" pour 70-79/90-99,
 * "quatre-vingts" et "cents" au pluriel uniquement en fin de nombre et sans
 * mot derriere.
 */

const UNITES = [
  "zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
  "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix sept", "dix huit", "dix neuf",
];

const DIZAINES = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
  8: "quatre vingt",
};

function direDeuxChiffres(n, { finDeNombre } = {}) {
  if (n < 20) return UNITES[n];

  const dizaine = Math.floor(n / 10);
  const unite = n % 10;

  if (dizaine === 7 || dizaine === 9) {
    // soixante-dix (70-79) / quatre-vingt-dix (90-99)
    const base = dizaine === 7 ? "soixante" : "quatre vingt";
    if (unite === 1 && dizaine === 7) return `${base} et onze`;
    return `${base} ${UNITES[10 + unite]}`;
  }

  const mot = DIZAINES[dizaine];
  if (!mot) return UNITES[n]; // ne devrait pas arriver

  if (unite === 0) {
    // "quatre-vingts" ne prend le s qu'en fin de nombre, sans rien derriere
    if (dizaine === 8) return finDeNombre ? `${mot}s` : mot;
    return mot;
  }
  if (unite === 1 && dizaine !== 8) return `${mot} et un`;
  return `${mot} ${UNITES[unite]}`;
}

function direCentaines(n, { finDeNombre } = {}) {
  if (n < 100) return direDeuxChiffres(n, { finDeNombre });

  const centaines = Math.floor(n / 100);
  const reste = n % 100;

  let mot = centaines === 1 ? "cent" : `${direDeuxChiffres(centaines)} cent`;
  if (reste === 0) {
    // "cents" ne prend le s qu'en fin de nombre, sans rien derriere, et
    // seulement s'il y a plus d'une centaine
    if (centaines > 1 && finDeNombre) mot += "s";
    return mot;
  }
  return `${mot} ${direDeuxChiffres(reste, { finDeNombre })}`;
}

const TRANCHES = [
  { valeur: 1_000_000_000, singulier: "milliard", pluriel: "milliards" },
  { valeur: 1_000_000, singulier: "million", pluriel: "millions" },
  { valeur: 1_000, singulier: "mille", pluriel: "mille" }, // "mille" est invariable
];

/**
 * @param {number} n entier positif ou nul
 * @returns {string} n en toutes lettres, en majuscules
 */
function nombreEnLettres(n) {
  n = Math.round(n);
  if (n === 0) return "ZERO";
  if (n < 0) return `MOINS ${nombreEnLettres(-n)}`;

  const parties = [];
  let reste = n;

  for (const tranche of TRANCHES) {
    const count = Math.floor(reste / tranche.valeur);
    if (count > 0) {
      if (tranche.valeur === 1000 && count === 1) {
        parties.push("mille");
      } else {
        const mot = count === 1 ? tranche.singulier : tranche.pluriel;
        parties.push(`${direCentaines(count)} ${mot}`);
      }
      reste %= tranche.valeur;
    }
  }

  if (reste > 0 || parties.length === 0) {
    parties.push(direCentaines(reste, { finDeNombre: true }));
  }

  return parties.join(" ").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Formate un montant en dinars tunisiens (3 decimales, dinars + millimes)
 * en toutes lettres, dans le style utilise sur les factures existantes :
 * "HUIT CENT SOIXANTE DIX HUIT DINARS 598 MILLIMES".
 *
 * @param {number} montant montant en dinars (ex: 878.598)
 */
function montantEnLettresDT(montant) {
  const total = Math.round(montant * 1000); // en millimes, evite les flottants
  const dinars = Math.floor(total / 1000);
  const millimes = total % 1000;

  const motsDinars = nombreEnLettres(dinars);
  const uniteDinar = dinars <= 1 ? "DINAR" : "DINARS";

  if (millimes === 0) {
    return `${motsDinars} ${uniteDinar}`;
  }
  const millimesStr = String(millimes).padStart(3, "0");
  return `${motsDinars} ${uniteDinar} ${millimesStr} MILLIMES`;
}

module.exports = { nombreEnLettres, montantEnLettresDT };
