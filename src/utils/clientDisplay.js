// Les factures generees avant l'ajout du catalogue clients stockent
// `invoice.client` comme une simple chaine (le nom). Depuis le catalogue,
// c'est un instantane { id, nom, code, adresse }. Cette fonction lit l'un ou
// l'autre pour un affichage simple (liste, recherche, tableaux).
export function nomClient(client) {
  if (!client) return "";
  if (typeof client === "string") return client;
  return client.nom || "";
}

export function codeClient(client) {
  if (!client || typeof client === "string") return "";
  return client.code || "";
}
