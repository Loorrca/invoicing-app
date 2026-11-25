import React, { useEffect, useMemo, useRef, useState } from "react";
import { nomClient, codeClient } from "../utils/clientDisplay.js";
import { correspondTranslitteration } from "../utils/translitteration.js";

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Meme principe de defilement/annees-ouvertes preserve entre deux montages
// (retour depuis "Modifier") que InvoicesList.jsx - variables de module,
// propres a CE fichier (un fichier = un module = son propre etat, aucun
// risque de collision avec celles de InvoicesList.jsx).
let dernierScrollTop = 0;
let expandedYearsMemoire = null;

export default function BonsLivraison({ onEdit, onCreerFacture }) {
  const [bons, setBons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [printingId, setPrintingId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [expandedYears, setExpandedYears] = useState(() => expandedYearsMemoire || new Set());
  const premierAffichageRef = useRef(true);

  async function refresh() {
    if (premierAffichageRef.current) setLoading(true);
    const list = await window.api.listBonsLivraison();
    setBons(list);
    if (expandedYearsMemoire === null) {
      const annees = list.map((b) => (b.date || "").slice(0, 4)).filter((a) => /^\d{4}$/.test(a));
      const plusRecente = annees.length ? annees.sort().slice(-1)[0] : String(new Date().getFullYear());
      expandedYearsMemoire = new Set([plusRecente]);
      setExpandedYears(expandedYearsMemoire);
    }
    setLoading(false);
    premierAffichageRef.current = false;
  }

  function toggleYear(year) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      expandedYearsMemoire = next;
      return next;
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const panneau = document.querySelector(".content");
    if (!panneau) return;
    function onScroll() {
      dernierScrollTop = panneau.scrollTop;
    }
    panneau.addEventListener("scroll", onScroll);
    return () => panneau.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (loading) return;
    const panneau = document.querySelector(".content");
    if (panneau) panneau.scrollTop = dernierScrollTop;
  }, [loading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bons
      .filter((b) => {
        if (
          q &&
          !(b.numero || "").toLowerCase().includes(q) &&
          !nomClient(b.client).toLowerCase().includes(q) &&
          !codeClient(b.client).toLowerCase().includes(q) &&
          !correspondTranslitteration(nomClient(b.client), query)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.numero || "").localeCompare(a.numero || "", "fr", { numeric: true }));
  }, [bons, query]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const b of filtered) {
      const year = /^\d{4}$/.test((b.date || "").slice(0, 4)) ? b.date.slice(0, 4) : "Sans date";
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(b);
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === "Sans date") return 1;
        if (b[0] === "Sans date") return -1;
        return b[0].localeCompare(a[0]);
      })
      .map(([year, rows]) => ({ year, rows }));
  }, [filtered]);

  function toggleSelected(id, dejaFacture) {
    if (dejaFacture) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleOpenPdf(id) {
    setStatus(null);
    try {
      const result = await window.api.openBonLivraisonPdf(id);
      if (!result.opened) {
        setStatus({ kind: "error", text: result.error || "Impossible d'ouvrir le PDF." });
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handlePrint(id) {
    setStatus(null);
    setPrintingId(id);
    try {
      const result = await window.api.printBonLivraison(id);
      if (!result.ok) {
        if (!result.canceled) {
          setStatus({ kind: "error", text: result.error || "Impossible d'imprimer le bon de livraison." });
        }
      } else if (result.saved) {
        setStatus({ kind: "ok", text: `PDF enregistre (pas d'imprimante detectee) : ${result.filePath}` });
      } else if (result.printed) {
        setStatus({ kind: "ok", text: "Bon de livraison envoye a l'imprimante." });
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    } finally {
      setPrintingId(null);
    }
  }

  async function handleDelete(id) {
    await window.api.deleteBonLivraisonRecord(id);
    setConfirmDeleteId(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await refresh();
  }

  // Fusionne les lignes de tous les bons selectionnes, en regroupant par
  // code article (une meme reference livree sur plusieurs bons devient une
  // seule ligne, quantites additionnees) - evite une facture avec dix fois
  // la meme designation si le client a ete livre en plusieurs fois.
  function fusionnerLignes(bonsSelectionnes) {
    const parCode = new Map();
    const ordre = [];
    for (const b of bonsSelectionnes) {
      for (const l of b.lignes || []) {
        const cle = (l.code || "").trim().toLowerCase() || `__${l.designation}`;
        if (!parCode.has(cle)) {
          parCode.set(cle, { code: l.code || "", designation: l.designation || "", quantite: 0, prixUnitaire: 0 });
          ordre.push(cle);
        }
        parCode.get(cle).quantite += Number(l.quantite) || 0;
      }
    }
    return ordre.map((cle) => parCode.get(cle));
  }

  function handleCreerFacture() {
    setStatus(null);
    const bonsSelectionnes = bons.filter((b) => selected.has(b.id));
    if (bonsSelectionnes.length === 0) return;

    const dejaFactures = bonsSelectionnes.filter((b) => b.factureId);
    if (dejaFactures.length > 0) {
      setStatus({
        kind: "error",
        text: `${dejaFactures.length > 1 ? "Plusieurs bons selectionnes sont" : "Un bon selectionne est"} deja rattache a une facture (N° ${dejaFactures
          .map((b) => b.factureNumero)
          .filter(Boolean)
          .join(", ")}). Deselectionnez-le avant de continuer.`,
      });
      return;
    }

    // Comparaison par id client quand disponible, sinon par nom exact
    // (cas d'un client "libre", non rattache au catalogue) - voir le meme
    // repli dans NewInvoice.jsx/NewBonLivraison.jsx.
    function clientKey(client) {
      if (client && typeof client === "object") return client.id ? `id:${client.id}` : `nom:${(client.nom || "").trim().toLowerCase()}`;
      return `nom:${String(client || "").trim().toLowerCase()}`;
    }
    const cles = new Set(bonsSelectionnes.map((b) => clientKey(b.client)));
    if (cles.size > 1) {
      setStatus({
        kind: "error",
        text: "Les bons de livraison selectionnes n'ont pas tous le meme client. Selectionnez uniquement des bons du meme client pour creer une facture.",
      });
      return;
    }

    const client = bonsSelectionnes[0].client;
    const lignes = fusionnerLignes(bonsSelectionnes);
    const numeros = bonsSelectionnes
      .slice()
      .sort((a, b) => (a.numero || "").localeCompare(b.numero || "", "fr", { numeric: true }))
      .map((b) => b.numero)
      .filter(Boolean);

    onCreerFacture?.({
      client,
      lignes,
      bonsLivraison: numeros,
      bonsLivraisonSourceIds: bonsSelectionnes.map((b) => b.id),
    });
  }

  const nbSelectionnes = selected.size;

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page page-xwide">
      <div className="page-header-row">
        <div>
          <h1>Bons de livraison</h1>
          <p className="subtitle">
            Historique des bons de livraison. Selectionnez un ou plusieurs bons d'un meme client pour creer la
            facture correspondante (prix a renseigner sur l'onglet Facture).
          </p>
        </div>
        <button type="button" className="btn primary" onClick={handleCreerFacture} disabled={nbSelectionnes === 0}>
          Creer la facture{nbSelectionnes > 0 ? ` (${nbSelectionnes})` : ""}
        </button>
      </div>

      <div className="invoices-search-row">
        <input
          type="text"
          className="invoices-search"
          placeholder="Rechercher par client, code client ou numero..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="subtitle">
          {query ? "Aucun bon de livraison ne correspond a cette recherche." : "Aucun bon de livraison pour le moment."}
        </p>
      ) : (
        groups.map((g) => {
          const isOpen = expandedYears.has(g.year);
          return (
            <div key={g.year} className="invoices-year-group">
              <button
                type="button"
                className="invoices-year-bar"
                onClick={() => toggleYear(g.year)}
                aria-expanded={isOpen}
              >
                <span className={`invoices-year-arrow ${isOpen ? "open" : ""}`}>&#9656;</span>
                <span className="invoices-year-label">{g.year}</span>
                <span className="invoices-year-count">
                  {g.rows.length} bon{g.rows.length > 1 ? "s" : ""}
                </span>
              </button>

              {isOpen && (
                <div className="table-scroll">
                  <table className="invoices-table">
                    <thead>
                      <tr>
                        <th style={{ width: "4%" }}></th>
                        <th>N&deg;</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Facture</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((b) => {
                        const dejaFacture = !!b.factureId;
                        return (
                          <tr key={b.id} className={dejaFacture ? "row-muted" : ""}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(b.id)}
                                disabled={dejaFacture}
                                onChange={() => toggleSelected(b.id, dejaFacture)}
                              />
                            </td>
                            <td>{b.numero}</td>
                            <td>{formatDate(b.date)}</td>
                            <td>{nomClient(b.client)}</td>
                            <td>{dejaFacture ? `Facture N° ${b.factureNumero || ""}` : "—"}</td>
                            <td className="invoices-actions">
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => handlePrint(b.id)}
                                disabled={printingId === b.id}
                              >
                                {printingId === b.id ? "Impression..." : "Imprimer"}
                              </button>
                              <button type="button" className="btn secondary" onClick={() => handleOpenPdf(b.id)}>
                                Revoir le PDF
                              </button>
                              <button type="button" className="btn secondary" onClick={() => onEdit?.(b.id)}>
                                Modifier
                              </button>
                              {confirmDeleteId === b.id ? (
                                <>
                                  <button type="button" className="btn link" onClick={() => handleDelete(b.id)}>
                                    Confirmer
                                  </button>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    onClick={() => setConfirmDeleteId(null)}
                                  >
                                    Annuler
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn icon"
                                  onClick={() => setConfirmDeleteId(b.id)}
                                  aria-label="Supprimer ce bon de livraison"
                                >
                                  &times;
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
