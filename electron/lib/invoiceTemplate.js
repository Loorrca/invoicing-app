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

// Le dinar tunisien n'a pas de sous-unite en dessous du millime (3 decimales) :
// un prix unitaire ne doit donc jamais afficher ou utiliser un 4e chiffre
// apres la virgule (ex. 16 HT + FODEC 1% + TVA 19% = 19,2304 — ce 4e chiffre
// n'existe dans aucune monnaie reelle). On arrondit au millime le plus proche
// (1-4 vers le bas, 5-9 vers le haut, comme Math.round) AVANT tout calcul ou
// affichage, et on reutilise ce prix arrondi pour le Total de la ligne : le
// P.U.HT imprime x la Qte imprimee redonne alors exactement le Total imprime,
// au lieu de deux chiffres qui ne se recoupent pas sur le papier.
function arrondirMillime(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
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
//
// Le TOTAL T.T.C n'est plus calcule en taxant le sous-total HT global une
// seule fois (ce qui pouvait laisser un 4e chiffre invisible, ex. 16 HT ->
// 19,2304 par piece avant meme d'etre multiplie) : chaque ligne calcule son
// propre prix unitaire TTC, arrondi au millime le plus proche, PUIS multiplie
// par la quantite — comme demande, pour que "300 x 16 HT" retombe sur un
// TOTAL T.T.C de 5 769,000 (et non 5 769,120, qui gardait un residu de
// 0,0004 DT par piece non representable en dinars). Le sous-total HT et le
// FODEC restent calcules normalement ; la T.V.A affichee est deduite du TTC
// reellement facture (TTC - HT - FODEC) pour que les trois lignes du
// recapitulatif se recoupent exactement avec le TOTAL T.T.C imprime.
function calculerTotaux(lignes, avecFodec, avecTimbre, timbre) {
  const tauxFodec = avecFodec ? 0.01 : 0;
  let ht = 0;
  let ttc = 0;
  for (const l of lignes) {
    const qte = Number(l.quantite) || 0;
    const puHt = arrondirMillime(l.prixUnitaire);
    const puTtc = arrondirMillime(puHt * (1 + tauxFodec) * 1.19);
    ht += qte * puHt;
    ttc += qte * puTtc;
  }
  const fodec = avecFodec ? ht * 0.01 : 0;
  const tva = ttc - ht - fodec;
  const timbreApplique = avecTimbre ? Number(timbre) || 0 : 0;
  const totalGeneral = ttc + timbreApplique;
  return {
    ht: arrondirMillime(ht),
    fodec: arrondirMillime(fodec),
    tva: arrondirMillime(tva),
    ttc: arrondirMillime(ttc),
    timbre: arrondirMillime(timbreApplique),
    totalGeneral: arrondirMillime(totalGeneral),
  };
}

/**
 * Produit le HTML imprimable d'une facture (letterhead + tableau + totaux
 * + montant en toutes lettres), pret a etre transforme en PDF.
 *
 * @param {object} company  { company_name, address, rne, tax_id, tel_fax, phone, email, rib, siege, logo_data_url, qr_data_url, invoice_template }
 *   `tel_fax` et `phone` (affiche "Mob") sont tous les deux optionnels et
 *   independants — certaines entreprises (ex. MASTERFLAG) n'ont pas de
 *   tel/fax, seulement un mobile. `siege` est le nom du siege/agence de la
 *   banque associe au RIB, affiche sous la boite "Coordonnees bancaires".
 *   `invoice_template` : "classic" (par defaut) ou "lignes" — deux gabarits
 *   visuels au choix par entreprise (meme position de logo/en-tete, memes
 *   donnees, seule la mise en forme du tableau/des totaux/des encadres
 *   change ; aucune couleur n'intervient dans la difference, tout reste
 *   imprimable a l'encre noire). Le QR code (§ ci-dessous) n'est affiche
 *   que sur le gabarit "classic".
 * @param {object} invoice  { numero, date, client, bonCommande, bonLivraison, lignes, avecFodec, avecTimbre, timbre }
 *   `client` est soit une chaine (anciennes factures), soit un instantane
 *   { id, nom, code, adresse } venant du catalogue clients.
 */
function renderInvoiceHtml(company = {}, invoice = {}) {
  // Deux gabarits au choix par entreprise (voir le commentaire JSDoc
  // ci-dessus) : "lignes" reste le seul autre cas reconnu, toute autre
  // valeur (y compris absente) retombe sur "classic" par securite.
  const variant = company.invoice_template === "lignes" ? "lignes" : "classic";
  // Le QR code (site web/boutique) n'a de sens que pour l'entreprise qui
  // l'utilise (TEXBANNER, gabarit "classic") — jamais affiche sur "lignes",
  // meme si un QR a ete enregistre par erreur sur ce profil.
  const showQr = variant === "classic" && !!company.qr_data_url;
  // Tel/fax et Mob (ex-"phone") sur la meme ligne, l'email juste en dessous
  // (voir le bloc .company .meta plus bas) : certaines entreprises n'ont pas
  // de tel/fax (ex. MASTERFLAG) donc chaque partie est omise si vide, comme
  // le reste des champs d'identite de ce bloc.
  const telMobParts = [];
  if (company.tel_fax) telMobParts.push(`Tel/fax : ${escapeHtml(company.tel_fax)}`);
  if (company.phone) telMobParts.push(`Mob : ${escapeHtml(company.phone)}`);
  const telMobLine = telMobParts.join("  ");
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
    const prixUnitaire = arrondirMillime(l.prixUnitaire);
    const total = (Number(l.quantite) || 0) * prixUnitaire;
    return `
      <tr>
        <td class="code">${escapeHtml(l.code || "")}</td>
        <td class="designation" dir="${dirAuto(l.designation)}">${escapeHtml(l.designation)}</td>
        <td class="num">${formatMontant(l.quantite).replace(",000", "")}</td>
        <td class="num">${formatMontant(prixUnitaire)}</td>
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

  // Recapitulatif des totaux : inchange sur "classic" (bloc vertical, QR a
  // gauche quand il y en a un). Sur "lignes", P.T.H.T/FODEC/T.V.A/Timbre
  // passent sur une bande horizontale (espace libere par l'absence de QR
  // sur ce gabarit, voir CSS ci-dessus), TOTAL T.T.C/NET A PAYER restant
  // dans un encadre final aligne a droite.
  const totauxHtml = variant === "lignes"
    ? `<div class="totaux-lignes">
    <div class="totaux-strip">
      <div class="totaux-item"><span class="ti-label">P.T.H.T</span><span class="ti-val">${formatMontant(ht)}</span></div>
      ${avecFodec ? `<div class="totaux-item"><span class="ti-label">FODEC 1%</span><span class="ti-val">${formatMontant(fodec)}</span></div>` : ""}
      <div class="totaux-item"><span class="ti-label">T.V.A 19%</span><span class="ti-val">${formatMontant(tva)}</span></div>
      ${timbre > 0 ? `<div class="totaux-item"><span class="ti-label">Timbre fiscal</span><span class="ti-val">${formatMontant(timbre)}</span></div>` : ""}
    </div>
    <table class="totaux-final">
      <tr class="ttc"><td class="label">TOTAL T.T.C</td><td class="val">${formatMontant(ttc)}</td></tr>
      ${timbre > 0 ? `<tr class="net"><td class="label">NET A PAYER</td><td class="val">${formatMontant(totalGeneral)}</td></tr>` : ""}
    </table>
  </div>`
    : `<div class="totaux${showQr ? " with-qr" : ""}">
    ${showQr ? `
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
  </div>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Facture ${escapeHtml(invoice.numero || "")}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * {
    box-sizing: border-box;
    /* Sans cette ligne, certains pilotes d'imprimante (notamment sous
       Windows) economisent l'encre en attenuant ou en supprimant les
       aplats de couleur CSS (ex. l'en-tete noir du tableau d'articles) a
       l'impression native — alors que l'export PDF (printToPDF) n'a jamais
       ce probleme, lui, car il ne passe par aucun pilote. Cette propriete
       force le moteur de rendu a garder la couleur exacte, sur toutes les
       plateformes. */
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
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
  /* Gabarit "lignes" (deuxieme entreprise) : meme en-tete/logo, memes
     donnees, mais une presentation en grille/lignes pleines plutot que les
     aplats du gabarit "classic" — coins carres au lieu d'arrondis, tableau
     entierement quadrille (bordures verticales en plus des horizontales),
     en-tete du tableau a double filet au lieu d'un fond noir plein, une
     police differente (serif, plus "officielle") pour accentuer encore la
     distinction avec le gabarit "classic", et un recapitulatif des totaux
     en deux temps : P.T.H.T/FODEC/T.V.A/Timbre sur une bande horizontale
     (pour utiliser l'espace laisse libre par l'absence de QR code sur ce
     gabarit) puis TOTAL T.T.C/NET A PAYER dans un encadre en dessous.
     Aucune couleur n'intervient : uniquement du noir sur blanc, a l'encre
     noire. Les regles qui suivent ne s'appliquent que lorsque la classe
     variant-lignes est posee sur la balise body (gabarit "lignes" uniquement). */
  body.variant-lignes {
    font-family: Georgia, "Times New Roman", Times, serif;
    /* Marge de securite supplementaire a droite : ce gabarit utilise toute
       la largeur imprimable (tableau quadrille, bande de totaux) jusqu'au
       bord, contrairement au gabarit "classic" ou le bloc de totaux reste
       plus en retrait. Decale tous les encadres/tableaux vers la gauche
       pour eviter qu'ils ne soient rognes par la zone non imprimable du
       cote droit de l'imprimante (signale sur MASTERFLAG uniquement). */
    padding-right: 6mm;
  }
  .variant-lignes .client-block .box,
  .variant-lignes .lettres,
  .variant-lignes .signature-box {
    border-radius: 0;
  }
  .variant-lignes table.lignes {
    border-top: 1px solid #1a1a1a;
    border-left: 1px solid #1a1a1a;
  }
  .variant-lignes table.lignes th {
    background: transparent;
    color: #1a1a1a;
    border-bottom: 2px solid #1a1a1a;
    border-right: 1px solid #1a1a1a;
  }
  .variant-lignes table.lignes td {
    border-right: 1px solid #1a1a1a;
    border-bottom: 1px solid #1a1a1a;
  }
  /* Bande horizontale P.T.H.T / FODEC / T.V.A / Timbre : utilise la largeur
     disponible sous le tableau au lieu d'empiler ces lignes verticalement. */
  .variant-lignes .totaux-strip {
    display: flex;
    gap: 3mm;
    margin-bottom: 3mm;
  }
  .variant-lignes .totaux-item {
    flex: 1 1 0;
    border: 1px solid #1a1a1a;
    padding: 2mm 3mm;
    text-align: center;
  }
  .variant-lignes .totaux-item .ti-label {
    display: block;
    font-size: 8.5pt;
    text-transform: uppercase;
    color: #444;
    font-weight: 700;
    letter-spacing: 0.3px;
    margin-bottom: 1mm;
  }
  .variant-lignes .totaux-item .ti-val {
    display: block;
    font-size: 11pt;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Encadre final (TOTAL T.T.C / NET A PAYER), aligne a droite comme sur le
     gabarit "classic", sous la bande horizontale. */
  .variant-lignes table.totaux-final {
    margin-left: auto;
    border-collapse: collapse;
    min-width: 70mm;
    border: 1px solid #1a1a1a;
  }
  .variant-lignes table.totaux-final td {
    padding: 1.8mm 3mm;
    font-size: 10.5pt;
  }
  .variant-lignes table.totaux-final td.label { color: #444; font-weight: 500; }
  .variant-lignes table.totaux-final td.val { text-align: right; font-variant-numeric: tabular-nums; }
  .variant-lignes table.totaux-final tr.ttc td {
    border-top: 1.5px solid #1a1a1a;
    font-weight: 700;
    font-size: 12pt;
  }
  .variant-lignes table.totaux-final tr.net td {
    border-top: 3px double #1a1a1a;
    font-weight: 700;
    font-size: 12pt;
  }
</style>
</head>
<body class="${variant === "lignes" ? "variant-lignes" : ""}">
  <div class="letterhead">
    <div class="company">
      ${company.logo_data_url
        ? `<img src="${company.logo_data_url}" alt="logo" />`
        : ""}
      <div>
        <p class="name">${escapeHtml(company.company_name)}</p>
        <p class="meta">
          ${company.address ? escapeHtml(company.address) + "<br/>" : ""}
          ${company.rne ? "RNE : " + escapeHtml(company.rne) + "<br/>" : ""}
          ${company.tax_id ? "Matricule Fiscal : " + escapeHtml(company.tax_id) + "<br/>" : ""}
          ${telMobLine ? telMobLine + "<br/>" : ""}
          ${company.email ? escapeHtml(company.email) : ""}
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

  ${totauxHtml}

  <div class="bottom-block">
    <div class="lettres">
      Arr&ecirc;t&eacute;e la pr&eacute;sente facture &agrave; la somme de : ${montantLettres}.
    </div>

    <div class="signature-row">
      <div class="signature-box">
        <p class="signature-label">Coordonn&eacute;es bancaires</p>
        ${company.rib ? `<p class="signature-content">RIB : ${escapeHtml(company.rib)}</p>` : ""}
        ${company.siege ? `<p class="signature-content">Si&egrave;ge : ${escapeHtml(company.siege)}</p>` : ""}
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
