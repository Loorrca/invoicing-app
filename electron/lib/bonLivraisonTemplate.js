"use strict";

const { nomClient, codeClient, adresseClient } = require("./clientDisplay");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Detecte si une chaine contient des caracteres arabes, pour l'aligner a
// droite (memes clients qu'en facture, souvent nommes en arabe).
const RE_ARABE = /[؀-ۿ]/;
function dirAuto(texte) {
  return RE_ARABE.test(texte || "") ? "rtl" : "ltr";
}

function formatMontant(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Produit le HTML imprimable d'un bon de livraison (letterhead + tableau des
 * quantites livrees + double visa client/fournisseur), pret a etre
 * transforme en PDF.
 *
 * Reprend la STRUCTURE du modele fourni par l'utilisateur (titre + logo en
 * en-tete, bloc expediteur, puis un bloc "informations du bon" a gauche et
 * "Destinataire" a droite, table simple sans quadrillage vertical, double
 * visa, pied de page minimal) — volontairement en noir et blanc pur (pas de
 * remplissage colore sur l'en-tete de tableau, pas de couleur d'accent), et
 * sans les champs ecartes par l'utilisateur ("Emis par", "Details
 * bancaires") ni ceux absents du modele de donnees de l'appli ("Lieu",
 * "Contact client" - aucun champ de contact distinct du client lui-meme).
 * Voir electron/lib/invoiceTemplate.js pour l'equivalent facture (avec
 * HT/FODEC/TVA/TTC).
 *
 * @param {object} company { company_name, address, rne, tax_id, tel_fax, phone, email, logo_data_url, logo_bw_data_url }
 *   `logo_bw_data_url` (variante noir et blanc du logo, voir Settings.jsx) est
 *   utilisee en priorite ici — un bon de livraison reste imprimable a
 *   l'encre noire meme sur une imprimante non couleur. A defaut (pas encore
 *   renseignee pour cette entreprise), on retombe sur le logo couleur
 *   habituel plutot que de n'afficher aucun logo.
 * @param {object} bonLivraison { numero, date, client, bonCommande, lignes }
 *   `lignes` : [{ code, designation, quantite }] — pas de prixUnitaire, un
 *   bon de livraison ne porte jamais de montant.
 */
function renderBonLivraisonHtml(company = {}, bonLivraison = {}) {
  const logo = company.logo_bw_data_url || company.logo_data_url || "";

  const lignes = bonLivraison.lignes || [];
  const lignesHtml = lignes.map((l) => `
      <tr>
        <td class="code">${escapeHtml(l.code || "")}</td>
        <td class="designation" dir="${dirAuto(l.designation)}">${escapeHtml(l.designation)}</td>
        <td class="num">${formatMontant(l.quantite).replace(",000", "")}</td>
      </tr>`).join("");

  // Complete la table a une hauteur minimale, comme le gabarit facture.
  const lignesVides = Math.max(0, 9 - lignes.length);
  const videsHtml = Array.from({ length: lignesVides }, () => `
      <tr><td class="code">&nbsp;</td><td class="designation">&nbsp;</td><td class="num">&nbsp;</td></tr>`).join("");

  const nom = nomClient(bonLivraison.client);
  const code = codeClient(bonLivraison.client);
  const adresse = adresseClient(bonLivraison.client);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Bon de livraison ${escapeHtml(bonLivraison.numero || "")}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 0; }
  * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    color: #1a1a1a;
    font-size: 11pt;
    margin: 0;
  }

  /* En-tete : gros titre + logo sur la meme ligne, comme le modele fourni. */
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 4mm;
  }
  .header .title { font-size: 28pt; font-weight: 800; letter-spacing: 0.2px; margin: 0; }
  .header img { max-height: 42mm; max-width: 80mm; object-fit: contain; }
  .rule { border: none; border-top: 2.5px solid #1a1a1a; margin: 0 0 6mm; }
  .rule.thin { border-top-width: 1px; border-top-color: #999; }

  /* Bloc expediteur (notre entreprise), sous l'en-tete, pas a cote du logo. */
  .company .name { font-size: 12.5pt; font-weight: 700; margin: 0 0 1mm; }
  .company .meta { font-size: 9.5pt; font-style: italic; color: #333; line-height: 1.55; margin: 0 0 6mm; }

  /* Deux blocs cote a cote : infos du bon (gauche, fond gris) / destinataire (droite). */
  .info-row { display: flex; justify-content: space-between; gap: 8mm; margin-bottom: 6mm; align-items: stretch; }
  .info-box {
    flex: 1 1 0; background: #f0f0f0; border-radius: 1.5mm; padding: 4mm 5mm;
  }
  .info-box .row { display: flex; gap: 3mm; font-size: 10pt; margin: 1mm 0; }
  .info-box .row .k { color: #444; min-width: 42mm; }
  .info-box .row .v { font-weight: 600; }
  .dest-box { flex: 1 1 0; padding: 4mm 5mm; }
  .dest-box .label {
    font-size: 9pt; text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; margin: 0 0 2mm;
  }
  .dest-box .nom { font-size: 11.5pt; font-weight: 700; margin: 0 0 1mm; }
  .dest-box .sub { font-size: 10pt; font-style: italic; color: #333; margin: 0.5mm 0; }

  /* Largeur explicite en mm (plutot que 100%) : sur certains moteurs
     d'impression, un tableau en table-layout:fixed suivant un conteneur
     flex (.info-row juste au-dessus) peut resoudre son "width:100%" par
     rapport a une largeur de bloc englobant incorrecte et se retrouver
     visiblement plus etroit que le reste de la page (rupture de symetrie).
     186mm = 210mm (A4) - 12mm - 12mm (marges gauche/droite de @page
     ci-dessus) : la largeur exacte de la zone imprimable, qu'aucune
     resolution de pourcentage ne peut donc faire deraper. */
  table.lignes { width: 186mm; border-collapse: collapse; margin-bottom: 10mm; table-layout: fixed; }
  table.lignes th {
    font-size: 9.5pt; text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px;
    padding: 2mm 3mm; text-align: left; border-bottom: 1.5px solid #1a1a1a;
  }
  table.lignes th.num, table.lignes td.num { text-align: right; }
  table.lignes td { padding: 1.8mm 3mm; border-bottom: 1px solid #ccc; font-size: 10.5pt; overflow-wrap: break-word; }
  td.code, th.code { font-size: 9.5pt; color: #444; }
  table.lignes tr { break-inside: avoid; page-break-inside: avoid; }

  .refs { font-size: 9.5pt; font-style: italic; color: #444; margin: -3mm 0 6mm; }

  .signature-row {
    display: flex; justify-content: space-between; gap: 14mm; margin-bottom: 8mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  /* min-height genereux : laisse assez de place en blanc sous "Signature :"
     / "Cachet et signature :" pour signer/tamponner a la main, au lieu de
     coller directement le pied de page juste en dessous. */
  .signature-box { flex: 1 1 0; min-height: 38mm; }
  .signature-label { font-size: 10.5pt; font-weight: 700; margin: 0 0 3mm; }
  .signature-content { font-size: 10pt; margin: 2mm 0; }

  .footer {
    font-size: 8.5pt; color: #555; text-align: center; border-top: 1px solid #aaa; padding: 3mm 0 4mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .bottom-bar { height: 4mm; background: #1a1a1a; margin: 0 -12mm; }
  .bottom-block { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="header">
    <p class="title">BON DE LIVRAISON</p>
    ${logo ? `<img src="${logo}" alt="logo" />` : ""}
  </div>
  <hr class="rule" />

  <div class="company">
    <p class="name">${escapeHtml(company.company_name)}</p>
    <p class="meta">
      ${company.address ? escapeHtml(company.address) + "<br/>" : ""}
      ${[company.tel_fax, company.phone].filter(Boolean).map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}
    </p>
  </div>

  <div class="info-row">
    <div class="info-box">
      <div class="row"><span class="k">Bon de livraison N&deg; :</span><span class="v">${escapeHtml(bonLivraison.numero || "")}</span></div>
      <div class="row"><span class="k">Date :</span><span class="v">${formatDate(bonLivraison.date)}</span></div>
      <div class="row"><span class="k">Bon de commande N&deg; :</span><span class="v">${bonLivraison.bonCommande ? escapeHtml(bonLivraison.bonCommande) : "-"}</span></div>
    </div>
    <div class="dest-box">
      <p class="label">Destinataire</p>
      <p class="nom" dir="${dirAuto(nom)}">${escapeHtml(nom)}</p>
      ${adresse ? `<p class="sub" dir="${dirAuto(adresse)}">${escapeHtml(adresse)}</p>` : ""}
      ${code ? `<p class="sub">Code client : ${escapeHtml(code)}</p>` : ""}
    </div>
  </div>

  <table class="lignes">
    <thead>
      <tr>
        <th class="code" style="width:15%">Code</th>
        <th>D&eacute;signation</th>
        <th class="num" style="width:15%">Quantit&eacute;</th>
      </tr>
    </thead>
    <tbody>
      ${lignesHtml}
      ${videsHtml}
    </tbody>
  </table>

  <div class="bottom-block">
    <div class="signature-row">
      <div class="signature-box">
        <p class="signature-label">Visa du client</p>
        <p class="signature-content">Re&ccedil;u le : ________________________</p>
        <p class="signature-content">Signature :</p>
      </div>
      <div class="signature-box">
        <p class="signature-label">Visa du fournisseur</p>
        <p class="signature-content">Livr&eacute; le : ________________________</p>
        <p class="signature-content">Cachet et signature :</p>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(company.company_name)}${company.address ? " &nbsp;&middot;&nbsp; " + escapeHtml(company.address) : ""}
    </div>
  </div>
  <div class="bottom-bar"></div>
</body>
</html>`;
}

module.exports = { renderBonLivraisonHtml };
