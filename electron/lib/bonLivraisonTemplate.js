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

// Demande explicite de l'utilisateur et de son pere : TEXBANNER et
// MASTERFLAG doivent avoir deux gabarits de bon de livraison completement
// differents, au point qu'un tiers ne devine pas qu'il s'agit du meme
// groupe - voir les deux fonctions de rendu ci-dessous, chacune avec sa
// propre mise en page/typographie, choisie en echo au logo de l'entreprise
// (sceau ovale pour TEXBANNER, pavillon moderne pour MASTERFLAG). Les deux
// restent volontairement en PUR NIVEAU DE GRIS (aucune couleur, meme en
// accent) : ces bons sont imprimes sur une imprimante LASER noir et blanc,
// contrairement aux factures - voir aussi logo_bw_data_url ci-dessous.

function ligneCommune(bonLivraison, client) {
  return {
    nom: nomClient(client),
    code: codeClient(client),
    adresse: adresseClient(client),
  };
}

function lignesHtml(lignes, vides, cellules) {
  const reelles = (lignes || []).map(
    (l) => `
      <tr>
        <td class="code">${escapeHtml(l.code || "")}</td>
        <td dir="${dirAuto(l.designation)}">${escapeHtml(l.designation)}</td>
        <td class="num">${formatMontant(l.quantite).replace(",000", "")}</td>
      </tr>`
  );
  const videsHtml = Array.from(
    { length: vides },
    () => `<tr><td class="code">&nbsp;</td><td>&nbsp;</td><td class="num">&nbsp;</td></tr>`
  );
  return reelles.join("") + videsHtml.join("");
}

// ===========================================================================
// TEXBANNER — heritage / letterpress (echo du sceau ovale du logo) : serif,
// encadrements fins, double filet, tout en gris neutre.
// ===========================================================================
function renderBonLivraisonHtmlTexbanner(company = {}, bonLivraison = {}) {
  const logo = company.logo_bw_data_url || company.logo_data_url || "";
  const lignes = bonLivraison.lignes || [];
  const vides = Math.max(0, 7 - lignes.length);
  const { nom, code, adresse } = ligneCommune(bonLivraison, bonLivraison.client);
  const coordonnees = [company.address, [company.tel_fax, company.phone].filter(Boolean).join(" &middot; ")]
    .filter(Boolean)
    .join(" &nbsp;&middot;&nbsp; ");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Bon de livraison ${escapeHtml(bonLivraison.numero || "")}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 0; }
  * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { font-family: "Georgia", "Times New Roman", serif; color: #1a1a1a; font-size: 10.8pt; margin: 0; }

  .entete { text-align: center; margin-bottom: 4mm; }
  .entete img { height: 26mm; margin-bottom: 2mm; }
  .raison-sociale { font-size: 17pt; font-weight: 700; letter-spacing: 1.5px; margin: 0; }
  .accroche { font-size: 9.5pt; font-style: italic; color: #595959; margin: 1mm 0 0; }

  .filet-double { border: none; border-top: 2.2px solid #2b2b2b; margin: 3mm 0 0.6mm; }
  .filet-double.fin { border-top: 0.8px solid #2b2b2b; margin: 0 0 5mm; }

  .coordonnees { text-align: center; font-size: 8.8pt; color: #474747; margin: 0 0 6mm; line-height: 1.6; }

  .titre-doc { text-align: center; margin: 0 0 6mm; }
  .titre-doc span {
    display: inline-block; font-variant: small-caps; font-size: 14pt; font-weight: 700;
    letter-spacing: 3px; padding: 1.5mm 8mm; border-top: 1px solid #2b2b2b; border-bottom: 1px solid #2b2b2b;
  }

  .info-row { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 7mm; }
  .fiche { flex: 1 1 0; border: 1px solid #b3b3b3; padding: 4mm 5mm; break-inside: avoid; page-break-inside: avoid; }
  .fiche .ligne { display: flex; gap: 3mm; font-size: 9.6pt; margin: 1.2mm 0; }
  .fiche .cle { font-variant: small-caps; letter-spacing: 0.5px; color: #595959; min-width: 38mm; }
  .fiche .val { font-weight: 700; }
  .fiche .etiquette {
    font-variant: small-caps; font-size: 9pt; letter-spacing: 1px; color: #595959;
    border-bottom: 1px solid #b3b3b3; padding-bottom: 1mm; margin-bottom: 2mm;
  }
  .fiche .nom-client { font-size: 11.5pt; font-weight: 700; margin: 0 0 1mm; }
  .fiche .sub { font-size: 9.6pt; font-style: italic; color: #474747; margin: 0.5mm 0; }

  table.lignes { width: 100%; border-collapse: collapse; margin-bottom: 9mm; }
  table.lignes th {
    font-variant: small-caps; font-size: 9.5pt; letter-spacing: 0.8px; font-weight: 700;
    padding: 2.2mm 3mm; text-align: left; border-top: 1.6px solid #1a1a1a; border-bottom: 1.6px solid #1a1a1a;
  }
  table.lignes th.num, table.lignes td.num { text-align: right; }
  table.lignes td { padding: 2mm 3mm; border-bottom: 0.6px solid #cccccc; font-size: 10.2pt; overflow-wrap: break-word; }
  table.lignes tr { break-inside: avoid; page-break-inside: avoid; }
  td.code, th.code { font-size: 9pt; color: #595959; font-family: "Courier New", monospace; }

  .signatures { display: flex; justify-content: space-between; gap: 16mm; margin: 4mm 0 5mm; break-inside: avoid; page-break-inside: avoid; }
  .signature { flex: 1 1 0; border: 1px solid #b3b3b3; padding: 4mm 5mm; min-height: 22mm; }
  .signature .label { font-variant: small-caps; letter-spacing: 1px; font-weight: 700; font-size: 10.5pt; margin: 0 0 3mm; text-align: center; }
  .signature .ligne-signature { font-size: 9.8pt; margin: 2mm 0; }

  .pied { text-align: center; font-size: 8.3pt; font-style: italic; color: #595959; padding-top: 2.5mm; break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="entete">
    ${logo ? `<img src="${logo}" alt="logo" />` : ""}
    <p class="raison-sociale">${escapeHtml(company.company_name)}</p>
    ${company.activite ? `<p class="accroche">${escapeHtml(company.activite)}</p>` : ""}
  </div>
  <hr class="filet-double" />
  <hr class="filet-double fin" />
  ${coordonnees ? `<p class="coordonnees">${coordonnees}</p>` : ""}

  <div class="titre-doc"><span>Bon de Livraison</span></div>

  <div class="info-row">
    <div class="fiche">
      <p class="etiquette">Reference du bon</p>
      <div class="ligne"><span class="cle">Bon de livraison N&deg;</span><span class="val">${escapeHtml(bonLivraison.numero || "")}</span></div>
      <div class="ligne"><span class="cle">Date</span><span class="val">${formatDate(bonLivraison.date)}</span></div>
      <div class="ligne"><span class="cle">Bon de commande N&deg;</span><span class="val">${bonLivraison.bonCommande ? escapeHtml(bonLivraison.bonCommande) : "-"}</span></div>
    </div>
    <div class="fiche">
      <p class="etiquette">Destinataire</p>
      <p class="nom-client" dir="${dirAuto(nom)}">${escapeHtml(nom)}</p>
      ${adresse ? `<p class="sub" dir="${dirAuto(adresse)}">${escapeHtml(adresse)}</p>` : ""}
      ${code ? `<p class="sub">Code client : ${escapeHtml(code)}</p>` : ""}
    </div>
  </div>

  <table class="lignes">
    <thead>
      <tr><th class="code" style="width:15%">Code</th><th>D&eacute;signation</th><th class="num" style="width:15%">Quantit&eacute;</th></tr>
    </thead>
    <tbody>
      ${lignesHtml(lignes, vides)}
    </tbody>
  </table>

  <div class="signatures">
    <div class="signature">
      <p class="label">Visa du Client</p>
      <p class="ligne-signature">Re&ccedil;u le : ________________________</p>
      <p class="ligne-signature">Signature :</p>
    </div>
    <div class="signature">
      <p class="label">Visa du Fournisseur</p>
      <p class="ligne-signature">Livr&eacute; le : ________________________</p>
      <p class="ligne-signature">Cachet et signature :</p>
    </div>
  </div>

  <hr class="filet-double fin" />
  <p class="pied">${escapeHtml(company.company_name)}${company.address ? " &nbsp;&middot;&nbsp; " + escapeHtml(company.address) : ""}${company.rne ? " &nbsp;&middot;&nbsp; RNE " + escapeHtml(company.rne) : ""}${company.tax_id ? " &nbsp;&middot;&nbsp; MF " + escapeHtml(company.tax_id) : ""}</p>
</body>
</html>`;
}

// ===========================================================================
// MASTERFLAG — moderne / corporate (echo du pavillon du logo) : sans-serif
// condense, bandeaux pleins, tableau contraste, tout en gris neutre.
// ===========================================================================
function renderBonLivraisonHtmlMasterflag(company = {}, bonLivraison = {}) {
  const logo = company.logo_bw_data_url || company.logo_data_url || "";
  const lignes = bonLivraison.lignes || [];
  const vides = Math.max(0, 11 - lignes.length);
  const { nom, code, adresse } = ligneCommune(bonLivraison, bonLivraison.client);
  const contactDroite = [company.tel_fax, company.phone, company.email].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Bon de livraison ${escapeHtml(bonLivraison.numero || "")}</title>
<style>
  @page { size: A4; margin: 0 14mm; }
  * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { font-family: "Arial", "Helvetica Neue", sans-serif; color: #1a1a1a; font-size: 10.5pt; margin: 0; }

  .bandeau-haut { height: 9mm; background: #1a1a1a; margin: 0 -14mm 10mm; }

  .entete { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6mm; }
  .entete-gauche .titre-doc { font-size: 33pt; font-weight: 900; letter-spacing: -0.5px; color: #1a1a1a; margin: 0; text-transform: uppercase; }
  .entete img { height: 30mm; }

  .pill {
    display: inline-block; background: #ededed; color: #1a1a1a; font-size: 7.6pt; font-weight: 700;
    letter-spacing: 0.6px; text-transform: uppercase; padding: 1.6mm 4mm; border-radius: 10mm; margin: 3mm 0 0;
  }

  .bandeau-identite {
    display: flex; justify-content: space-between; background: #1a1a1a; color: #fff;
    padding: 3.5mm 5mm; margin: 0 0 7mm; font-size: 8.6pt; letter-spacing: 0.3px;
  }
  .bandeau-identite b { color: #fff; }

  .info-row { display: flex; gap: 6mm; margin-bottom: 7mm; }
  .case { flex: 1 1 0; background: #f0f0f0; border-left: 2.2mm solid #1a1a1a; padding: 5mm 6mm; break-inside: avoid; page-break-inside: avoid; }
  .case.accent { border-left-color: #4d4d4d; }
  .case .etiquette { font-size: 7.8pt; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #595959; margin: 0 0 2.5mm; }
  .case .ligne { display: flex; justify-content: space-between; font-size: 9.6pt; margin: 1.6mm 0; }
  .case .ligne .val { font-weight: 700; }
  .case .nom-client { font-size: 12pt; font-weight: 800; margin: 0 0 1.5mm; }
  .case .sub { font-size: 9.3pt; color: #474747; margin: 0.8mm 0; }

  table.lignes { width: 100%; border-collapse: collapse; margin-bottom: 9mm; }
  table.lignes thead tr { background: #1a1a1a; }
  table.lignes th {
    color: #fff; font-size: 8.6pt; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    padding: 3mm 3.5mm; text-align: left;
  }
  table.lignes th.num, table.lignes td.num { text-align: right; }
  table.lignes td { padding: 2.8mm 3.5mm; border-bottom: 0.7px solid #d9d9d9; font-size: 10pt; overflow-wrap: break-word; }
  table.lignes tr { break-inside: avoid; page-break-inside: avoid; }
  table.lignes tbody tr:nth-child(odd) { background: #f7f7f7; }
  td.code, th.code { font-size: 8.4pt; color: #595959; font-family: "Consolas", monospace; }
  table.lignes td.num { font-weight: 800; color: #1a1a1a; }

  .signatures { display: flex; justify-content: space-between; gap: 14mm; margin: 2mm 0 8mm; break-inside: avoid; page-break-inside: avoid; }
  .signature { flex: 1 1 0; background: #f0f0f0; border-left: 2.2mm solid #1a1a1a; padding: 5mm 6mm; min-height: 26mm; }
  .signature:last-child { border-left-color: #4d4d4d; }
  .signature .label {
    display: inline-block; background: #1a1a1a; color: #fff; font-size: 8.6pt; font-weight: 700;
    letter-spacing: 0.6px; text-transform: uppercase; padding: 1.6mm 4mm; margin: 0 0 5mm;
  }
  .signature .ligne-signature { font-size: 9.8pt; margin: 3.5mm 0; color: #474747; }

  .pied { font-size: 7.8pt; color: #595959; text-align: center; border-top: 0.6px solid #d9d9d9; padding-top: 3mm; text-transform: uppercase; letter-spacing: 0.4px; break-inside: avoid; page-break-inside: avoid; }
  .bandeau-bas { height: 8mm; background: #1a1a1a; margin: 4mm -14mm 0; }
</style>
</head>
<body>
  <div class="bandeau-haut"></div>

  <div class="entete">
    <div class="entete-gauche">
      <p class="titre-doc">Bon de Livraison</p>
      ${company.activite ? `<div><span class="pill">${escapeHtml(company.activite)}</span></div>` : ""}
    </div>
    ${logo ? `<img src="${logo}" alt="logo" />` : ""}
  </div>

  <div class="bandeau-identite">
    <span><b>${escapeHtml(company.company_name)}</b>${company.address ? " &nbsp;&middot;&nbsp; " + escapeHtml(company.address) : ""}</span>
    ${contactDroite ? `<span>${contactDroite}</span>` : ""}
  </div>

  <div class="info-row">
    <div class="case accent">
      <p class="etiquette">Destinataire</p>
      <p class="nom-client" dir="${dirAuto(nom)}">${escapeHtml(nom)}</p>
      ${adresse ? `<p class="sub" dir="${dirAuto(adresse)}">${escapeHtml(adresse)}</p>` : ""}
      ${code ? `<p class="sub">Code client : ${escapeHtml(code)}</p>` : ""}
    </div>
    <div class="case">
      <p class="etiquette">R&eacute;f&eacute;rence</p>
      <div class="ligne"><span>Bon de livraison N&deg;</span><span class="val">${escapeHtml(bonLivraison.numero || "")}</span></div>
      <div class="ligne"><span>Date</span><span class="val">${formatDate(bonLivraison.date)}</span></div>
      <div class="ligne"><span>Bon de commande N&deg;</span><span class="val">${bonLivraison.bonCommande ? escapeHtml(bonLivraison.bonCommande) : "-"}</span></div>
    </div>
  </div>

  <table class="lignes">
    <thead>
      <tr><th class="code" style="width:15%">Code</th><th>D&eacute;signation</th><th class="num" style="width:15%">Quantit&eacute;</th></tr>
    </thead>
    <tbody>
      ${lignesHtml(lignes, vides)}
    </tbody>
  </table>

  <div class="signatures">
    <div class="signature">
      <p class="label">Visa Client</p>
      <p class="ligne-signature">Re&ccedil;u le : ________________________</p>
      <p class="ligne-signature">Signature :</p>
    </div>
    <div class="signature">
      <p class="label">Visa Fournisseur</p>
      <p class="ligne-signature">Livr&eacute; le : ________________________</p>
      <p class="ligne-signature">Cachet et signature :</p>
    </div>
  </div>

  <p class="pied">${escapeHtml(company.company_name)}${company.rne ? " &nbsp;&middot;&nbsp; RNE " + escapeHtml(company.rne) : ""}${company.tax_id ? " &nbsp;&middot;&nbsp; MF " + escapeHtml(company.tax_id) : ""}</p>
  <div class="bandeau-bas"></div>
</body>
</html>`;
}

// Choisit le gabarit a utiliser pour cette entreprise : le champ explicite
// `bon_livraison_template` (reglable dans l'onglet Entreprise) fait foi ;
// a defaut (entreprise pas encore migree/configuree), on retombe sur une
// reconnaissance par nom, puis sur le gabarit TEXBANNER par defaut.
function renderBonLivraisonHtml(company = {}, bonLivraison = {}) {
  const gabarit = company.bon_livraison_template || devinerGabaritParNom(company.company_name);
  if (gabarit === "masterflag") return renderBonLivraisonHtmlMasterflag(company, bonLivraison);
  return renderBonLivraisonHtmlTexbanner(company, bonLivraison);
}

function devinerGabaritParNom(nom) {
  if ((nom || "").trim().toUpperCase() === "MASTERFLAG") return "masterflag";
  return "texbanner";
}

module.exports = { renderBonLivraisonHtml };
