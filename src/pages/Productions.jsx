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
// enregistrees (pas de nouvelle saisie) : on additionne, par designation
// d'article, les quantites de toutes les factures dont la date est
// superieure ou egale a la date choisie.
export default function Productions() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [depuis, setDepuis] = useState("");

  useEffect(() => {
    window.api
      .listInvoices()
      .then((list) => {
        setInvoices(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (depuis ? invoices.filter((f) => (f.date || "") >= depuis) : invoices),
    [invoices, depuis]
  );

  const totals = useMemo(() => {
    const map = new Map();
    for (const f of filtered) {
      for (const l of f.lignes || []) {
        const designation = (l.designation || "").trim();
        if (!designation) continue;
        const qty = Number(l.quantite) || 0;
        map.set(designation, (map.get(designation) || 0) + qty);
      }
    }
    return [...map.entries()]
      .map(([designation, quantite]) => ({ designation, quantite }))
      .sort((a, b) => b.quantite - a.quantite);
  }, [filtered]);

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
              <th>Article</th>
              <th className="num">Quantite produite</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.designation}>
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
