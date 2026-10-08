"use strict";

// Fusion de deux tableaux d'enregistrements synchronisables (factures,
// clients, ou articles — meme principe pour les trois) en un seul, par id.
//
// Principe : un seul poste est utilise a la fois (jamais deux en meme
// temps), mais au moment ou on bascule d'un poste a l'autre, les deux
// copies locales ont pu diverger un peu depuis leur dernier sync — il faut
// donc comparer enregistrement par enregistrement, jamais ecraser un
// fichier entier par l'autre (voir la discussion avec l'utilisateur : c'est
// exactement le risque qu'avait l'ancien import de sauvegarde, qui remplace
// tout en bloc).
//
// Pour chaque id present dans l'un des deux tableaux (ou les deux), on
// garde la version dont `updatedAt` est le plus recent. Une suppression est
// un enregistrement comme un autre une fois "douce" (voir deleteInvoice /
// deleteClient / deleteArticle : elles posent deletedAt + updatedAt au lieu
// de retirer l'enregistrement) : si elle est la version la plus recente,
// elle gagne la fusion et reste donc supprimee cote fusionne, au lieu de
// ressusciter parce que l'autre poste n'etait pas encore au courant.
//
// IMPORTANT : les deux tableaux passes en entree doivent venir de
// listAllForSync() (tombstones inclus), jamais des fonctions list* que
// l'app affiche (qui filtrent deja les supprimes) — sinon une suppression
// ne serait plus jamais vue par la fusion et reviendrait a chaque sync.
function fusionnerParId(local, distant) {
  const parId = new Map();
  for (const rec of local || []) {
    if (rec && rec.id) parId.set(rec.id, rec);
  }
  for (const rec of distant || []) {
    if (!rec || !rec.id) continue;
    const existant = parId.get(rec.id);
    if (!existant || horodatage(rec) > horodatage(existant)) {
      parId.set(rec.id, rec);
    }
  }
  return [...parId.values()];
}

// `updatedAt` est toujours renseigne par addX/updateX/deleteX depuis cette
// evolution ; `createdAt` sert de repli pour un enregistrement ecrit avant
// son ajout (migration silencieuse : jamais de comparaison avec une valeur
// manquante, qui finirait toujours perdante face a une version synchronisee
// plus recente — ce qui est le comportement voulu).
function horodatage(rec) {
  return rec.updatedAt || rec.createdAt || "";
}

module.exports = { fusionnerParId, horodatage };
