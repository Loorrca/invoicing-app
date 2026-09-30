import React, { useEffect, useMemo, useState } from "react";

const BAR_COLOR = "#2a78d6";
const BAR_COLOR_HOVER = "#1c5cab";

function fmtMoney(n) {
  return `${(Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
}

function fmtQty(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function fmtDate(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d || "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Tous les calculs de mois se font en index entier (annee*12 + mois-0-indexe),
// jamais via toISOString() : le champ "date" des factures est une date locale
// sans heure ("2026-08-05"), et melanger ca avec un Date UTC serialise decale
// silencieusement le mois d'un cran des qu'on est dans un fuseau horaire
// autre que UTC (ex. Africa/Tunis, UTC+1).
function ymIndex(dateStr) {
  const m = /^(\d{4})-(\d{2})/.exec(dateStr || "");
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
}

function ymLabel(idx) {
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  const label = new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Trace un rectangle arrondi seulement en haut (le mark "grandit" depuis la
// ligne de base, qui reste bien droite).
function roundedTopBarPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0) return "";
  if (r <= 0) return `M${x},${y + height} L${x},${y} L${x + width},${y} L${x + width},${y + height} Z`;
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
}

function EvolutionChart({ months }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...months.map((m) => m.value));
  const plotHeight = 140;
  const topPad = 22;
  const bottomPad = 24;
  const barMaxWidth = 24;
  const slot = Math.max(46, Math.min(72, 640 / Math.max(months.length, 1)));
  const chartWidth = Math.max(320, months.length * slot);
  const barWidth = Math.min(barMaxWidth, slot - 10);
  const height = plotHeight + topPad + bottomPad;

  return (
    <div className="chart-scroll">
      <svg width={chartWidth} height={height} role="img" aria-label="Chiffre d'affaires par mois">
        <line
          x1={0}
          y1={topPad + plotHeight}
          x2={chartWidth}
          y2={topPad + plotHeight}
          stroke="#c3c2b7"
          strokeWidth="1"
        />
        {months.map((m, i) => {
          const barH = max > 0 ? (m.value / max) * (plotHeight - 6) : 0;
          const x = i * slot + (slot - barWidth) / 2;
          const y = topPad + plotHeight - barH;
          const isHover = hover === i;
          return (
            <g key={`${m.label}-${i}`}>
              <rect
                x={x - 8}
                y={topPad - 18}
                width={barWidth + 16}
                height={plotHeight + 18}
                fill="transparent"
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
              >
                <title>{`${m.label} : ${fmtMoney(m.value)}`}</title>
              </rect>
              <path d={roundedTopBarPath(x, y, barWidth, barH, 4)} fill={isHover ? BAR_COLOR_HOVER : BAR_COLOR} />
              {m.value > 0 && (
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="#52514e">
                  {fmtQty(m.value)}
                </text>
              )}
              <text x={x + barWidth / 2} y={topPad + plotHeight + 16} textAnchor="middle" fontSize="10.5" fill="#898781">
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HorizontalBars({ data, formatValue }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbar-chart">
      {data.map((d, i) => {
        const pct = max > 0 && d.value > 0 ? Math.max((d.value / max) * 100, 3) : 0;
        return (
          <div
            key={d.label}
            className="hbar-row"
            tabIndex={0}
            title={`${d.label} : ${formatValue(d.value)}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
          >
            <span className="hbar-label">{d.label}</span>
            <div className="hbar-track">
              <div
                className="hbar-fill"
                style={{ width: `${pct}%`, background: hover === i ? BAR_COLOR_HOVER : BAR_COLOR }}
              />
            </div>
            <span className="hbar-value">{formatValue(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatTile({ label, value, delta }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta !== null && delta !== undefined && (
        <div className={`stat-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs mois precedent
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ onGoToInvoices, onGoToPaiements }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paiements, setPaiements] = useState(null);

  useEffect(() => {
    window.api
      .listInvoices()
      .then((list) => {
        setInvoices(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    window.api
      .scanPayments()
      .then((res) => setPaiements(res?.ok ? res : null))
      .catch(() => setPaiements(null));
  }, []);

  const stats = useMemo(() => {
    const monthTotals = new Map();
    let earliestIdx = null;
    let totalHT = 0;
    const clientTotals = new Map();
    const productTotals = new Map();

    for (const f of invoices) {
      const ht = f.totaux?.ht || 0;
      totalHT += ht;

      const idx = ymIndex(f.date);
      if (idx !== null) {
        monthTotals.set(idx, (monthTotals.get(idx) || 0) + ht);
        if (earliestIdx === null || idx < earliestIdx) earliestIdx = idx;
      }

      const client = (f.client || "").trim();
      if (client) clientTotals.set(client, (clientTotals.get(client) || 0) + ht);

      for (const l of f.lignes || []) {
        const designation = (l.designation || "").trim();
        if (!designation) continue;
        productTotals.set(designation, (productTotals.get(designation) || 0) + (Number(l.quantite) || 0));
      }
    }

    const now = new Date();
    const nowIdx = now.getFullYear() * 12 + now.getMonth();
    const twelveAgoIdx = nowIdx - 11;
    const startIdx = earliestIdx !== null && earliestIdx > twelveAgoIdx ? earliestIdx : twelveAgoIdx;

    const months = [];
    for (let idx = startIdx; idx <= nowIdx; idx++) {
      months.push({ label: ymLabel(idx), value: monthTotals.get(idx) || 0 });
    }

    const thisMonthHT = monthTotals.get(nowIdx) || 0;
    const prevMonthHT = monthTotals.get(nowIdx - 1) || 0;
    const delta = prevMonthHT > 0 ? ((thisMonthHT - prevMonthHT) / prevMonthHT) * 100 : null;

    const topClients = [...clientTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const topProducts = [...productTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    return { totalHT, months, thisMonthHT, prevMonthHT, delta, topClients, topProducts };
  }, [invoices]);

  if (loading) return <div className="page">Chargement...</div>;

  if (invoices.length === 0) {
    return (
      <div className="page">
        <h1>Tableau de bord</h1>
        <p className="subtitle">Aucune facture enregistree pour le moment pour cette entreprise.</p>
      </div>
    );
  }

  const recent = invoices.slice(0, 6);

  return (
    <div className="page page-wide">
      <h1>Tableau de bord</h1>
      <p className="subtitle">Vue d'ensemble de l'entreprise active.</p>

      <div className="kpi-row">
        <StatTile label="Chiffre d'affaires total (HT)" value={fmtMoney(stats.totalHT)} />
        <StatTile label="Ce mois-ci (HT)" value={fmtMoney(stats.thisMonthHT)} delta={stats.delta} />
        <StatTile label="Mois precedent (HT)" value={fmtMoney(stats.prevMonthHT)} />
      </div>

      <div className="card">
        <h2 className="section-title">Evolution du chiffre d'affaires (HT)</h2>
        <EvolutionChart months={stats.months} />
      </div>

      {paiements && (
        <div className="card">
          <div className="dashboard-card-header">
            <h2 className="section-title">Suivi des paiements (rapprochement BIAT)</h2>
            <button type="button" className="btn secondary" onClick={() => onGoToPaiements?.()}>
              Voir les paiements
            </button>
          </div>
          <div className="kpi-row" style={{ marginBottom: 0 }}>
            <StatTile label="Total encaissé" value={fmtMoney(paiements.recap.totalEncaisse)} />
            <StatTile label="Reste à encaisser" value={fmtMoney(paiements.recap.resteAEncaisser)} />
            <StatTile label="Factures à vérifier" value={fmtQty(paiements.recap.nbAVerifier)} />
          </div>
        </div>
      )}

      <div className="grid-2 dashboard-grid">
        <div className="card">
          <h2 className="section-title">Top clients (HT)</h2>
          {stats.topClients.length ? (
            <HorizontalBars data={stats.topClients} formatValue={fmtMoney} />
          ) : (
            <p className="subtitle">Aucune donnee.</p>
          )}
        </div>
        <div className="card">
          <h2 className="section-title">Top 5 articles (quantite)</h2>
          {stats.topProducts.length ? (
            <HorizontalBars data={stats.topProducts} formatValue={fmtQty} />
          ) : (
            <p className="subtitle">Aucune donnee.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="dashboard-card-header">
          <h2 className="section-title">Dernieres factures</h2>
          <button type="button" className="btn secondary" onClick={() => onGoToInvoices?.()}>
            Voir toutes les factures
          </button>
        </div>
        <table className="invoices-table">
          <thead>
            <tr>
              <th>N&deg;</th>
              <th>Date</th>
              <th>Client</th>
              <th className="num">Total T.T.C</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((f) => (
              <tr key={f.id}>
                <td>{f.numero}</td>
                <td>{fmtDate(f.date)}</td>
                <td>{f.client}</td>
                <td className="num">{fmtMoney(f.totaux?.ttc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
