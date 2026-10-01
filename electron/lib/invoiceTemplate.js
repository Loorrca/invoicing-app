"use strict";

const { montantEnLettresDT } = require("./numberToWords");
const { nomClient, codeClient, adresseClient } = require("./clientDisplay");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Detecte si une chaine contient des caracteres arabes, pour l'aligner a
// droite (les factures existantes melangent des clients en arabe et en latin).
const RE_ARABE = /[؀-ۿ]/;
function dirAuto(texte) {
  return RE_ARABE.test(texte || "") ? "rtl" : "ltr";
}

function formatMontant(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Le timbre fiscal est un montant fixe saisi a la main (il varie selon les
// annees/textes), optionnel : certaines factures (marches publics, clients
// exoneres...) n'en portent pas. Ne s'ajoute qu'apres coup, sans etre soumis
// a la T.V.A ni au FODEC.
function calculerTotaux(lignes, avecFodec, avecTimbre, timbre) {
  const ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), 0);
  const fodec = avecFodec ? ht * 0.01 : 0;
  const tva = (ht + fodec) * 0.19;
  const ttc = ht + fodec + tva;
  const arrondir = (n) => Math.round(n * 1000) / 1000;
  const timbreApplique = avecTimbre ? Number(timbre) || 0 : 0;
  const totalGeneral = ttc + timbreApplique;
  return {
    ht: arrondir(ht),
    fodec: arrondir(fodec),
    tva: arrondir(tva),
    ttc: arrondir(ttc),
    timbre: arrondir(timbreApplique),
    totalGeneral: arrondir(totalGeneral),
  };
}

/**
 * Produit le HTML imprimable d'une facture (letterhead + tableau + totaux
 * + montant en toutes lettres), pret a etre transforme en PDF.
 *
 * @param {object} company  { company_name, address, rne, tax_id, phone, email, rib, logo_data_url, qr_data_url }
 * @param {object} invoice  { numero, date, client, bonCommande, bonLivraison, lignes, avecFodec, avecTimbre, timbre }
 *   `client` est soit une chaine (anciennes factures), soit un instantane
 *   { id, nom, code, adresse } venant du catalogue clients.
 * @param {object} options  { hideLogo, onlyLogo }
 *   - hideLogo : impression sur papier a en-tete deja preimprime avec le
 *     logo en couleur — rend le logo INVISIBLE mais garde la meme image/les
 *     memes dimensions a sa place (au lieu de ne rien afficher du tout) :
 *     sans ca, le nom/l'adresse de l'entreprise glissent tout a gauche pour
 *     combler l'espace du logo absent, et se retrouvent a chevaucher le
 *     logo deja imprime sur le papier.
 *   - onlyLogo : l'inverse — pour imprimer/exporter le papier a en-tete
 *     lui-meme (juste le logo en couleur, a la bonne place), on cache tout
 *     le reste (textes, cadres, tableau...) et on ne garde que le logo
 *     visible, au meme endroit exact que sur une facture normale (meme
 *     gabarit HTML/CSS, donc meme position garantie).
 */
function renderInvoiceHtml(company = {}, invoice = {}, options = {}) {
  const lignes = invoice.lignes || [];
  const avecFodec = invoice.avecFodec !== false;
  const avecTimbre = !!invoice.avecTimbre;
  const { ht, fodec, tva, ttc, timbre, totalGeneral } = calculerTotaux(
    lignes,
    avecFodec,
    avecTimbre,
    invoice.timbre
  );
  const montantLettres = montantEnLettresDT(totalGeneral);

  const lignesHtml = lignes.map((l) => {
    const total = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0);
    return `
      <tr>
        <td class="code">${escapeHtml(l.code || "")}</td>
        <td class="designation" dir="${dirAuto(l.designation)}">${escapeHtml(l.designation)}</td>
        <td class="num">${formatMontant(l.quantite).replace(",000", "")}</td>
        <td class="num">${formatMontant(l.prixUnitaire)}</td>
        <td class="num">${formatMontant(total)}</td>
      </tr>`;
  }).join("");

  // Complete la table a une hauteur minimale, comme sur le gabarit existant.
  const lignesVides = Math.max(0, 9 - lignes.length);
  const videsHtml = Array.from({ length: lignesVides }, () => `
      <tr><td class="code">&nbsp;</td><td class="designation">&nbsp;</td><td class="num">&nbsp;</td><td class="num">&nbsp;</td><td class="num">&nbsp;</td></tr>`).join("");

  // Une facture peut etre livree en plusieurs fois (chantiers etales sur
  // plusieurs semaines) : autant de bons de livraison que de livraisons.
  const bonsLivraison = (Array.isArray(invoice.bonLivraison)
    ? invoice.bonLivraison
    : invoice.bonLivraison ? [invoice.bonLivraison] : []
  ).map((v) => String(v).trim()).filter(Boolean);
  const labelBonLivraison = bonsLivraison.length > 1 ? "Bons de livraison N&deg; " : "Bon de livraison N&deg; ";

  const nom = nomClient(invoice.client);
  const code = codeClient(invoice.client);
  const adresse = adresseClient(invoice.client);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Facture ${escapeHtml(invoice.numero || "")}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    color: #1a1a1a;
    font-size: 11.5pt;
    margin: 0;
  }
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 7mm;
    margin-bottom: 6mm;
  }
  .company { display: flex; gap: 4mm; align-items: flex-start; }
  .company img { max-height: 22mm; max-width: 45mm; object-fit: contain; }
  .company .name { font-size: 15pt; font-weight: 700; margin: 0 0 1mm; }
  .company .meta { font-size: 9pt; color: #333; font-weight: 500; line-height: 1.5; margin: 0; }
  .invoice-meta { text-align: right; }
  .invoice-meta .title {
    font-size: 16pt; font-weight: 700; letter-spacing: 0.5px;
    margin: 0 0 2mm;
  }
  .invoice-meta .line { font-size: 10.5pt; margin: 0.5mm 0; }
  .client-block {
    display: flex; flex-wrap: wrap; justify-content: space-between; margin-bottom: 6mm; gap: 6mm;
  }
  .client-block .box {
    flex: 0 1 80mm; min-width: 65mm; max-width: 80mm;
    border: 1.5px solid #999; border-radius: 2mm; padding: 3mm 4mm;
    overflow-wrap: break-word; word-break: break-word;
  }
  /* Petite marge de securite pour que la bordure droite de la deuxieme boite
     (References) ne se retrouve jamais exactement sur le bord imprimable. */
  .client-block .box + .box {
    margin-right: 2mm;
  }
  .client-block .box .label {
    font-size: 8.5pt; text-transform: uppercase; color: #555; font-weight: 700; letter-spacing: 0.5px;
    margin: 0 0 1mm;
  }
  .client-block .box .value { font-size: 12pt; font-weight: 600; margin: 0; }
  .client-block .box .sub { font-size: 9.5pt; color: #444; font-weight: 500; margin: 1.5mm 0 0; }
  .refs { font-size: 9.5pt; color: #444; font-weight: 500; margin-top: 0; }
  table.lignes { width: 100%; border-collapse: collapse; margin-bottom: 6mm; table-layout: fixed; }
  table.lignes th {
    background: #1a1a1a; color: #fff; font-size: 9.5pt; text-transform: uppercase;
    padding: 2.5mm 3mm; text-align: left; letter-spacing: 0.3px;
  }
  table.lignes th.num, table.lignes td.num { text-align: right; }
  table.lignes td {
    padding: 1.6mm 3mm; border-bottom: 1px solid #aaa; font-size: 10.5pt;
    overflow-wrap: break-word;
  }
  td.code, th.code { font-size: 9.5pt; color: #444; }
  .totaux { display: flex; justify-content: flex-end; margin-bottom: 4mm; }
  /* Quand un QR code est renseigne (onglet Entreprise), on l'affiche dans
     l'espace laisse vide sous le tableau d'articles, a gauche du recapitulatif
     des taxes/totaux (qui lui reste colle au bord droit). */
  .totaux.with-qr { justify-content: space-between; align-items: flex-end; }
  .totaux-qr { display: flex; flex-direction: column; align-items: center; gap: 1mm; }
  .totaux-qr img { width: 22mm; height: 22mm; object-fit: contain; }
  .totaux-qr .totaux-qr-label {
    font-size: 7.5pt; color: #555; font-weight: 600; text-align: center; max-width: 26mm;
  }
  .totaux table { border-collapse: collapse; min-width: 70mm; }
  .totaux td { padding: 1.5mm 3mm; font-size: 10.5pt; }
  .totaux td.label { color: #444; font-weight: 500; }
  .totaux td.val { text-align: right; font-variant-numeric: tabular-nums; }
  .totaux tr.ttc td { border-top: 1.5px solid #1a1a1a; font-weight: 700; font-size: 12pt; }
  .totaux tr.net td { border-top: 1.5px solid #1a1a1a; font-weight: 700; font-size: 12pt; }
  .lettres {
    border: 1.5px solid #999; border-radius: 2mm; padding: 2.5mm 4mm;
    font-size: 10pt; font-weight: 500; font-style: italic; color: #222; margin-bottom: 6mm; margin-right: 3mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-row {
    display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 7mm;
    margin-right: 3mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-box {
    flex: 1 1 0;
    min-height: 24mm;
    border: 1.5px solid #999; border-radius: 2mm;
    padding: 2mm 4mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-label {
    font-size: 8.5pt; text-transform: uppercase; color: #555; font-weight: 700; letter-spacing: 0.5px;
    margin: 0;
  }
  .signature-content {
    font-size: 10pt; font-weight: 500; margin: 2mm 0 0;
  }
  .footer {
    font-size: 8.5pt; color: #555; font-weight: 500; text-align: center; border-top: 1px solid #aaa; padding-top: 3mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .bottom-block { break-inside: avoid; page-break-inside: avoid; }
  table.lignes tr { break-inside: avoid; page-break-inside: avoid; }
  /* Gabarit "logo seul" (papier a en-tete a preimprimer) : on masque tout
     le reste de la page (visibility:hidden est herite par tous les
     descendants) et on ne redonne la visibilite qu'au logo, qui garde ainsi
     exactement la meme position que sur une facture normale. */
  ${options.onlyLogo ? "body.only-logo { visibility: hidden; } body.only-logo .company img { visibility: visible; }" : ""}
</style>
</head>
<body${options.onlyLogo ? ' class="only-logo"' : ""}>
  <div class="letterhead">
    <div class="company">
      ${company.logo_data_url
        ? `<img src="${company.logo_data_url}" alt="logo"${options.hideLogo ? ' style="visibility:hidden"' : ""} />`
        : ""}
      <div>
        <p class="name">${escapeHtml(company.company_name)}</p>
        <p class="meta">
          ${company.address ? escapeHtml(company.address) + "<br/>" : ""}
          ${company.rne ? "RNE : " + escapeHtml(company.rne) + "<br/>" : ""}
          ${company.tax_id ? "Matricule Fiscal : " + escapeHtml(company.tax_id) + "<br/>" : ""}
          ${company.phone ? "Tel : " + escapeHtml(company.phone) + " " : ""}${company.email ? escapeHtml(company.email) : ""}
        </p>
      </div>
    </div>
    <div class="invoice-meta">
      <p class="title">FACTURE N&deg; ${escapeHtml(invoice.numero || "")}</p>
      <p class="line">Tunis, le ${formatDate(invoice.date)}</p>
    </div>
  </div>

  <div class="client-block">
    <div class="box">
      <p class="label">Client</p>
      <p class="value" dir="${dirAuto(nom)}">${escapeHtml(nom)}</p>
      ${code ? `<p class="sub">Code client : ${escapeHtml(code)}</p>` : ""}
      ${adresse ? `<p class="sub" dir="${dirAuto(adresse)}">${escapeHtml(adresse)}</p>` : ""}
    </div>
    ${(invoice.bonCommande || bonsLivraison.length) ? `
    <div class="box">
      <p class="label">R&eacute;f&eacute;rences</p>
      <p class="refs">
        ${invoice.bonCommande ? "Bon de commande N&deg; " + escapeHtml(invoice.bonCommande) + "<br/>" : ""}
        ${bonsLivraison.length ? labelBonLivraison + bonsLivraison.map(escapeHtml).join(", ") : ""}
      </p>
    </div>` : ""}
  </div>

  <table class="lignes">
    <thead>
      <tr>
        <th class="code" style="width:12%">Code</th>
        <th>Designation</th>
        <th class="num" style="width:10%">Qte</th>
        <th class="num" style="width:17%">P.U.HT</th>
        <th class="num" style="width:17%">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lignesHtml}
      ${videsHtml}
    </tbody>
  </table>

  <div class="totaux${company.qr_data_url ? " with-qr" : ""}">
    ${company.qr_data_url ? `
    <div class="totaux-qr">
      <img src="${company.qr_data_url}" alt="QR code" />
      <span class="totaux-qr-label">Boutique en ligne</span>
    </div>` : ""}
    <table>
      <tr><td class="label">P.T.H.T</td><td class="val">${formatMontant(ht)}</td></tr>
      ${avecFodec ? `<tr><td class="label">FODEC 1%</td><td class="val">${formatMontant(fodec)}</td></tr>` : ""}
      <tr><td class="label">T.V.A 19%</td><td class="val">${formatMontant(tva)}</td></tr>
      ${timbre > 0
        ? `<tr class="ttc"><td class="label">TOTAL T.T.C</td><td class="val">${formatMontant(ttc)}</td></tr>
      <tr><td class="label">Timbre fiscal</td><td class="val">${formatMontant(timbre)}</td></tr>
      <tr class="net"><td class="label">NET A PAYER</td><td class="val">${formatMontant(totalGeneral)}</td></tr>`
        : `<tr class="ttc"><td class="label">TOTAL T.T.C</td><td class="val">${formatMontant(ttc)}</td></tr>`
      }
    </table>
  </div>

  <div class="bottom-block">
    <div class="lettres">
      Arr&ecirc;t&eacute;e la pr&eacute;sente facture &agrave; la somme de : ${montantLettres}.
    </div>

    <div class="signature-row">
      <div class="signature-box">
        <p class="signature-label">Coordonn&eacute;es bancaires</p>
        ${company.rib ? `<p class="signature-content">RIB : ${escapeHtml(company.rib)}</p>` : ""}
      </div>
      <div class="signature-box">
        <p class="signature-label">Cachet et signature</p>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(company.company_name)}
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderInvoiceHtml, calculerTotaux };
