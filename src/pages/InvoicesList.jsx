import React, { useEffect, useMemo, useRef, useState } from "react";
import { nomClient, codeClient } from "../utils/clientDisplay.js";

function fmt(n) {
  return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const EMPTY_FILTERS = { du: "", au: "", montantMin: "", montantMax: "" };

// Position de defilement du panneau .content (voir App.jsx), gardee EN
// DEHORS du composant : "Modifier" change d'onglet dans App.jsx, ce qui
// demonte entierement InvoicesList (rendu conditionnel par onglet) puis le
// remonte au retour — un ref interne au composant ne survivrait pas a ce
// cycle, une variable de module si, puisque le module reste charge pendant
// toute la duree de vie de l'appli.
let dernierScrollTop = 0;

// Annees "ouvertes" (voir plus bas), gardees EN DEHORS du composant pour la
// meme raison que dernierScrollTop ci-dessus : sans ca, "Modifier" -> Save
// (qui remonte InvoicesList de zero) oubliait quelles annees l'utilisateur
// avait depliees et revenait a "seulement l'annee la plus recente" — ce qui
// pouvait rendre la liste bien plus courte qu'avant l'edition et empechait
// le defilement d'etre restaure correctement (rien a quoi le restaurer).
// null = "jamais initialise de toute la session" (vraiment le tout premier
// chargement), distinct d'un Set() vide (l'utilisateur a referme toutes les
// annees a la main).
let expandedYearsMemoire = null;

export default function InvoicesList({ onEdit }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [printingId, setPrintingId] = useState(null);
  // Annees "ouvertes" dans la liste groupee par annee (voir groups plus
  // bas). Initialise une seule fois par session (voir expandedYearsMemoire
  // plus haut), sur l'annee la plus recente qui a des factures (pas
  // forcement l'annee civile en cours, ex. aucune facture encore saisie en
  // janvier) — ni un refresh ulterieur (apres suppression, etc.) ni un
  // remontage du composant (retour depuis "Modifier") ne doivent
  // reinitialiser ce que l'utilisateur a deja ouvert/ferme a la main.
  const [expandedYears, setExpandedYears] = useState(() => expandedYearsMemoire || new Set());
  // Vrai seulement avant le tout premier chargement : un refresh() declenche
  // ensuite par une action (suppression...) ne doit pas remplacer toute la
  // liste par "Chargement..." le temps de recharger, sinon le panneau
  // .content (voir App.jsx) s'effondre puis se reconstruit, ce qui
  // reinitialise sa position de defilement (voir les effets plus bas).
  const premierAffichageRef = useRef(true);

  async function refresh() {
    if (premierAffichageRef.current) setLoading(true);
    const list = await window.api.listInvoices();
    setInvoices(list);
    if (expandedYearsMemoire === null) {
      const annees = list.map((f) => (f.date || "").slice(0, 4)).filter((a) => /^\d{4}$/.test(a));
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

  // Garde la position de defilement du panneau a jour en continu pendant que
  // la liste est affichee, pour qu'elle soit disponible au prochain montage
  // (retour depuis "Modifier", voir App.jsx).
  useEffect(() => {
    const panneau = document.querySelector(".content");
    if (!panneau) return;
    function onScroll() {
      dernierScrollTop = panneau.scrollTop;
    }
    panneau.addEventListener("scroll", onScroll);
    return () => panneau.removeEventListener("scroll", onScroll);
  }, []);

  // Restaure la position de defilement une fois la liste (de nouveau)
  // affichee : au tout premier montage (0, sans effet visible) comme au
  // retour depuis "Modifier" (ou apres toute autre raison de remontage).
  useEffect(() => {
    if (loading) return;
    const panneau = document.querySelector(".content");
    if (panneau) panneau.scrollTop = dernierScrollTop;
  }, [loading]);

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = filters.montantMin !== "" ? Number(filters.montantMin) : null;
    const max = filters.montantMax !== "" ? Number(filters.montantMax) : null;

    return invoices
      .filter((f) => {
        if (
          q &&
          !(f.numero || "").toLowerCase().includes(q) &&
          !nomClient(f.client).toLowerCase().includes(q) &&
          !codeClient(f.client).toLowerCase().includes(q)
        ) {
          return false;
        }
        if (filters.du && (f.date || "") < filters.du) return false;
        if (filters.au && (f.date || "") > filters.au) return false;
        const ttc = f.totaux?.ttc ?? null;
        if (min !== null && !Number.isNaN(min) && (ttc === null || ttc < min)) return false;
        if (max !== null && !Number.isNaN(max) && (ttc === null || ttc > max)) return false;
        return true;
      })
      // Tri par numero de facture (le plus grand/recent en premier), pas par
      // date d'ajout : {numeric: true} compare les numeros chiffre par
      // chiffre plutot que lettre par lettre, pour que l'ancien format sans
      // annee (ex. "0081") et le format actuel ("2026003") restent chacun
      // dans le bon ordre.
      .sort((a, b) => (b.numero || "").localeCompare(a.numero || "", "fr", { numeric: true }));
  }, [invoices, query, filters]);

  // Regroupe les factures (deja filtrees) par annee de la facture, du plus
  // recent au plus ancien, pour l'affichage en barres pliables/depliables —
  // la recherche et les filtres restent actifs a l'interieur de chaque
  // annee ; une annee sans aucune facture correspondante n'apparait tout
  // simplement pas.
  const groups = useMemo(() => {
    const map = new Map();
    for (const f of filtered) {
      const year = /^\d{4}$/.test((f.date || "").slice(0, 4)) ? f.date.slice(0, 4) : "Sans date";
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(f);
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === "Sans date") return 1;
        if (b[0] === "Sans date") return -1;
        return b[0].localeCompare(a[0]);
      })
      .map(([year, rows]) => ({
        year,
        rows,
        totalTtc: rows.reduce((s, f) => s + (f.totaux?.ttc || 0), 0),
      }));
  }, [filtered]);

  async function handleOpenPdf(id) {
    setStatus(null);
    try {
      const result = await window.api.openInvoicePdf(id);
      if (!result.opened) {
        setStatus({ kind: "error", text: result.error || "Impossible d'ouvrir le PDF." });
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  // Imprime la facture (boite d'impression native si une imprimante est
  // detectee, sinon demande ou enregistrer un PDF a la place) — voir
  // invoice:print dans electron/main.js. Le PDF/l'impression ne comporte
  // jamais le logo (papier a en-tete deja preimprime).
  async function handlePrint(id) {
    setStatus(null);
    setPrintingId(id);
    try {
      const result = await window.api.printInvoice(id);
      if (!result.ok) {
        if (!result.canceled) {
          setStatus({ kind: "error", text: result.error || "Impossible d'imprimer la facture." });
        }
      } else if (result.saved) {
        setStatus({ kind: "ok", text: `PDF enregistre (pas d'imprimante detectee) : ${result.filePath}` });
      } else if (result.printed) {
        setStatus({ kind: "ok", text: "Facture envoyee a l'imprimante." });
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    } finally {
      setPrintingId(null);
    }
  }

  async function handleDelete(id) {
    await window.api.deleteInvoiceRecord(id);
    setConfirmDeleteId(null);
    await refresh();
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page page-xwide">
      <h1>Factures</h1>
      <p className="subtitle">Historique des factures generees pour l'entreprise active.</p>

      <div className="invoices-search-row">
        <input
          type="text"
          className="invoices-search"
          placeholder="Rechercher par client, code client ou numero..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => setShowFilters((v) => !v)}>
          Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {showFilters && (
        <div className="card invoices-filters">
          <label>
            Du
            <input type="date" value={filters.du} onChange={(e) => updateFilter("du", e.target.value)} />
          </label>
          <label>
            Au
            <input type="date" value={filters.au} onChange={(e) => updateFilter("au", e.target.value)} />
          </label>
          <label>
            Montant min (TTC)
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="0.000"
              value={filters.montantMin}
              onChange={(e) => updateFilter("montantMin", e.target.value)}
            />
          </label>
          <label>
            Montant max (TTC)
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="—"
              value={filters.montantMax}
              onChange={(e) => updateFilter("montantMax", e.target.value)}
            />
          </label>
          {activeFilterCount > 0 && (
            <button type="button" className="btn link" onClick={() => setFilters(EMPTY_FILTERS)}>
              Réinitialiser les filtres
            </button>
          )}
        </div>
      )}

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="subtitle">
          {query || activeFilterCount > 0
            ? "Aucune facture ne correspond a cette recherche/ces filtres."
            : "Aucune facture pour le moment."}
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
                  {g.rows.length} facture{g.rows.length > 1 ? "s" : ""}
                </span>
                <span className="invoices-year-total">{fmt(g.totalTtc)} DT</span>
              </button>

              {isOpen && (
                <div className="table-scroll">
                  <table className="invoices-table">
                    <thead>
                      <tr>
                        <th>N&deg;</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th className="num">Total T.T.C</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((f) => (
                        <tr key={f.id}>
                          <td>{f.numero}</td>
                          <td>{formatDate(f.date)}</td>
                          <td>{nomClient(f.client)}</td>
                          <td className="num">{fmt(f.totaux?.ttc)} DT</td>
                          <td className="invoices-actions">
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => handlePrint(f.id)}
                              disabled={printingId === f.id}
                            >
                              {printingId === f.id ? "Impression..." : "Imprimer"}
                            </button>
                            <button type="button" className="btn secondary" onClick={() => handleOpenPdf(f.id)}>
                              Revoir le PDF
                            </button>
                            <button type="button" className="btn secondary" onClick={() => onEdit?.(f.id)}>
                              Modifier
                            </button>
                            {confirmDeleteId === f.id ? (
                              <>
                                <button type="button" className="btn link" onClick={() => handleDelete(f.id)}>
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
                                onClick={() => setConfirmDeleteId(f.id)}
                                aria-label="Supprimer cette facture"
                              >
                                &times;
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
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
