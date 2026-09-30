"use strict";

// Gabarit "Accent rouge" : bandeau plein, table zebree et accents rouges au
// lieu du noir/blanc du gabarit Classique. Structure volontairement
// differente (bandeau d'entete pleine largeur, encarts a bordure laterale)
// pour qu'une facture ne rappelle pas visuellement celles d'une entreprise
// utilisant le gabarit Classique.

const { montantEnLettresDT } = require("../numberToWords");
const { calculerTotaux } = require("../calculerTotaux");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

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

/**
 * @param {object} company  { company_name, address, rne, tax_id, phone, email, rib, logo_data_url }
 * @param {object} invoice  { numero, date, client, bonCommande, bonLivraison, lignes, avecFodec }
 */
function renderInvoiceHtml(company = {}, invoice = {}) {
  const lignes = invoice.lignes || [];
  const avecFodec = invoice.avecFodec !== false;
  const { ht, fodec, tva, ttc } = calculerTotaux(lignes, avecFodec);
  const montantLettres = montantEnLettresDT(ttc);

  const lignesHtml = lignes.map((l, i) => {
    const total = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0);
    return `
      <tr class="${i % 2 === 1 ? "zebra" : ""}">
        <td class="num">${formatMontant(l.quantite).replace(",000", "")}</td>
        <td class="designation" dir="${dirAuto(l.designation)}">${escapeHtml(l.designation)}</td>
        <td class="num">${formatMontant(l.prixUnitaire)}</td>
        <td class="num">${formatMontant(total)}</td>
      </tr>`;
  }).join("");

  const lignesVides = Math.max(0, 8 - lignes.length);
  const videsHtml = Array.from({ length: lignesVides }, (_, i) => {
    const parite = (lignes.length + i) % 2 === 1 ? "zebra" : "";
    return `<tr class="${parite}"><td class="num">&nbsp;</td><td class="designation">&nbsp;</td><td class="num">&nbsp;</td><td class="num">&nbsp;</td></tr>`;
  }).join("");

  const bonsLivraison = (Array.isArray(invoice.bonLivraison)
    ? invoice.bonLivraison
    : invoice.bonLivraison ? [invoice.bonLivraison] : []
  ).map((v) => String(v).trim()).filter(Boolean);
  const labelBonLivraison = bonsLivraison.length > 1 ? "Bons de livraison N&deg; " : "Bon de livraison N&deg; ";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Facture ${escapeHtml(invoice.numero || "")}</title>
<style>
  @page { size: A4; margin: 0 12mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    color: #2a1414;
    font-size: 11.5pt;
    margin: 0;
  }
  .bandeau {
    background: #b81f27;
    color: #fff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 -12mm;
    padding: 8mm 12mm;
    margin-bottom: 9mm;
  }
  .bandeau .company { display: flex; gap: 4mm; align-items: center; }
  .bandeau .logo-badge {
    background: #fff;
    border-radius: 50%;
    width: 20mm; height: 20mm;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    flex: none;
  }
  .bandeau .logo-badge img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .bandeau .name { font-size: 16pt; font-weight: 700; margin: 0 0 1mm; letter-spacing: 0.3px; }
  .bandeau .meta { font-size: 8.7pt; color: #ffe3e3; line-height: 1.55; margin: 0; }
  .bandeau .invoice-meta { text-align: right; }
  .bandeau .invoice-meta .title {
    font-size: 15pt; font-weight: 700; letter-spacing: 0.6px; margin: 0 0 2mm;
  }
  .bandeau .invoice-meta .line { font-size: 10pt; margin: 0.5mm 0; color: #ffe3e3; }

  .client-block { display: flex; justify-content: space-between; margin-bottom: 8mm; }
  .client-block .box {
    border-left: 3.5px solid #b81f27;
    background: #fbf1f1;
    padding: 3mm 5mm; min-width: 68mm;
  }
  .client-block .box .label {
    font-size: 8.5pt; text-transform: uppercase; color: #b81f27; letter-spacing: 0.6px;
    font-weight: 700; margin: 0 0 1mm;
  }
  .client-block .box .value { font-size: 12pt; font-weight: 600; margin: 0; }
  .refs { font-size: 9.5pt; color: #6b4a4a; margin-top: 2mm; }

  table.lignes { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.lignes th {
    background: #b81f27; color: #fff; font-size: 9.5pt; text-transform: uppercase;
    padding: 2.7mm 3mm; text-align: left; letter-spacing: 0.3px;
  }
  table.lignes th.num, table.lignes td.num { text-align: right; }
  table.lignes td {
    padding: 2mm 3mm; font-size: 10.5pt; border-bottom: 1px solid #f0dcdc;
  }
  table.lignes tr.zebra td { background: #fbf1f1; }

  .totaux { display: flex; justify-content: flex-end; margin-bottom: 6mm; }
  .totaux table {
    border-collapse: collapse; min-width: 72mm;
    border: 1px solid #e9c8c8; border-radius: 2mm; overflow: hidden;
  }
  .totaux td { padding: 1.8mm 4mm; font-size: 10.5pt; }
  .totaux td.label { color: #6b4a4a; }
  .totaux td.val { text-align: right; font-variant-numeric: tabular-nums; }
  .totaux tr.ttc td {
    background: #b81f27; color: #fff; font-weight: 700; font-size: 12pt;
  }

  .lettres {
    border-left: 3.5px solid #b81f27; background: #fbf1f1;
    padding: 3mm 5mm; font-size: 10pt; font-style: italic; margin-bottom: 8mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-row {
    display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 10mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-box {
    flex: 1 1 0; min-height: 28mm;
    border: 1px solid #e9c8c8; border-radius: 2mm;
    padding: 2mm 4mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .signature-label {
    font-size: 8.5pt; text-transform: uppercase; color: #b81f27; font-weight: 700;
    letter-spacing: 0.5px; margin: 0;
  }
  .signature-content { font-size: 10pt; margin: 2mm 0 0; color: #2a1414; }

  .footer-bar {
    margin: 0 -12mm; padding: 3mm 12mm;
    background: #b81f27; color: #ffe3e3;
    font-size: 8.5pt; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  .bottom-block { break-inside: avoid; page-break-inside: avoid; }
  table.lignes tr { break-inside: avoid; page-break-inside: avoid; }
  .page-body { padding: 0 12mm; }
</style>
</head>
<body>
  <div class="bandeau">
    <div class="company">
      <div class="logo-badge">
        ${company.logo_data_url ? `<img src="${company.logo_data_url}" alt="logo" />` : ""}
      </div>
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

  <div class="page-body">
    <div class="client-block">
      <div class="box">
        <p class="label">Client</p>
        <p class="value" dir="${dirAuto(invoice.client)}">${escapeHtml(invoice.client)}</p>
        <p class="refs">
          ${invoice.bonCommande ? "Bon de commande N&deg; " + escapeHtml(invoice.bonCommande) + "<br/>" : ""}
          ${bonsLivraison.length ? labelBonLivraison + bonsLivraison.map(escapeHtml).join(", ") : ""}
        </p>
      </div>
    </div>

    <table class="lignes">
      <thead>
        <tr>
          <th class="num" style="width:12%">Qte</th>
          <th>Designation</th>
          <th class="num" style="width:18%">P.U</th>
          <th class="num" style="width:18%">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lignesHtml}
        ${videsHtml}
      </tbody>
    </table>

    <div class="totaux">
      <table>
        <tr><td class="label">P.T.H.T</td><td class="val">${formatMontant(ht)}</td></tr>
        ${avecFodec ? `<tr><td class="label">FODEC 1%</td><td class="val">${formatMontant(fodec)}</td></tr>` : ""}
        <tr><td class="label">T.V.A 19%</td><td class="val">${formatMontant(tva)}</td></tr>
        <tr class="ttc"><td class="label">TOTAL T.T.C</td><td class="val">${formatMontant(ttc)}</td></tr>
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
    </div>
  </div>

  <div class="footer-bar">
    ${escapeHtml(company.company_name)}
  </div>
</body>
</html>`;
}

module.exports = { renderInvoiceHtml };
