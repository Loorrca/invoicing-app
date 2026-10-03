import React, { useEffect, useMemo, useState } from "react";

function fmtQty(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function fmtDate(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Les quantites "produites" sont deduites des lignes des factures deja
// enregistrees (pas de nouvelle saisie). Depuis que la designation de
// chaque ligne de facture est librement modifiable (voir NewInvoice.jsx —
// retouchee facture par facture, sans toucher au catalogue), on ne peut
// plus regrouper par ce texte : deux factures du meme article avec un
// libelle legerement different compteraient comme deux lignes separees.
// On regroupe donc par CODE article (le lien stable, insensible a la
// casse) et on affiche le nom par defaut actuel du catalogue pour ce code
// — jamais le libelle propre a telle ou telle facture.
// Secours pour les anciennes lignes sans code (saisies avant l'ajout du
// champ, ou jamais rattachees a un article du catalogue) : on regroupe
// alors par designation comme avant, pour ne rien perdre de l'historique.
export default function Productions() {
  const [invoices, setInvoices] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [depuis, setDepuis] = useState("");

  useEffect(() => {
    Promise.all([window.api.listInvoices(), window.api.listArticles()])
      .then(([invoiceList, articleList]) => {
        setInvoices(invoiceList);
        setArticles(articleList);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (depuis ? invoices.filter((f) => (f.date || "") >= depuis) : invoices),
    [invoices, depuis]
  );

  // Catalogue actuel indexe par code (en minuscules) : sert a retrouver le
  // nom par defaut a jour pour un code donne, meme si la facture portait un
  // libelle retouche.
  const articleByCode = useMemo(() => {
    const map = new Map();
    for (const a of articles) {
      const code = (a.code || "").trim().toLowerCase();
      if (code) map.set(code, a);
    }
    return map;
  }, [articles]);

  const totals = useMemo(() => {
    // key -> { code, designation, quantite }
    const map = new Map();
    for (const f of filtered) {
      for (const l of f.lignes || []) {
        const code = (l.code || "").trim();
        const designationLigne = (l.designation || "").trim();
        if (!code && !designationLigne) continue;
        const qty = Number(l.quantite) || 0;

        const key = code ? `code:${code.toLowerCase()}` : `nom:${designationLigne.toLowerCase()}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantite += qty;
        } else {
          // Nom par defaut = celui du catalogue actuel pour ce code s'il
          // existe encore ; a defaut (code supprime depuis, ou ligne sans
          // code), on retombe sur le libelle de cette ligne.
          const catalogue = code ? articleByCode.get(code.toLowerCase()) : null;
          map.set(key, {
            code,
            designation: catalogue ? catalogue.designation : designationLigne,
            quantite: qty,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.quantite - a.quantite);
  }, [filtered, articleByCode]);

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <h1>Productions</h1>
      <p className="subtitle">
        Quantites produites par article pour l'entreprise active, calculees a partir des lignes des factures deja
        enregistrees.
      </p>

      <label className="productions-filter">
        Depuis le
        <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} />
      </label>

      <p className="subtitle">
        {filtered.length} facture{filtered.length > 1 ? "s" : ""} prise{filtered.length > 1 ? "s" : ""} en compte
        {depuis ? ` depuis le ${fmtDate(depuis)}` : " (toutes les factures)"}.
      </p>

      {totals.length === 0 ? (
        <p className="subtitle">Aucune donnee pour cette periode.</p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th style={{ width: "18%" }}>Code</th>
              <th>Article</th>
              <th className="num">Quantite produite</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.code ? `code:${t.code}` : `nom:${t.designation}`}>
                <td>{t.code || "—"}</td>
                <td>{t.designation}</td>
                <td className="num">{fmtQty(t.quantite)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
