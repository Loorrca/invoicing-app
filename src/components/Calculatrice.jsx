import React, { useEffect, useMemo, useState } from "react";
import { TAUX_TVA, TAUX_FODEC } from "../utils/taxRates.js";

// Convertisseur P.H.T <-> P.T.T.C independant du formulaire de facture : deux
// cases, le P.H.T et le P.T.T.C, modifiables l'une comme l'autre a tout
// moment. Taper dans l'une recalcule l'autre automatiquement, sans avoir a
// choisir un "sens" de conversion au prealable. Reprend exactement la meme
// formule que le reste de l'application (FODEC optionnel puis T.V.A, voir
// utils/taxRates.js), pour donner le meme resultat qu'une vraie facture.

function depuisHt(htStr, avecFodec) {
  const ht = Number(htStr);
  if (htStr === "" || !Number.isFinite(ht) || ht < 0) return null;
  const fodec = avecFodec ? ht * TAUX_FODEC : 0;
  const tva = (ht + fodec) * TAUX_TVA;
  const ttc = ht + fodec + tva;
  return { ht, fodec, tva, ttc };
}

function depuisTtc(ttcStr, avecFodec) {
  const ttc = Number(ttcStr);
  if (ttcStr === "" || !Number.isFinite(ttc) || ttc < 0) return null;
  const facteurFodec = avecFodec ? 1 + TAUX_FODEC : 1;
  const ht = ttc / (facteurFodec * (1 + TAUX_TVA));
  const fodec = avecFodec ? ht * TAUX_FODEC : 0;
  const tva = (ht + fodec) * TAUX_TVA;
  return { ht, fodec, tva, ttc };
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// Valeur posee dans la case "opposee" a celle que l'utilisateur vient de
// taper : arrondie au millime, comme tout montant imprime sur une facture.
function fmtChamp(n) {
  if (!Number.isFinite(n)) return "";
  return (Math.round(n * 1000) / 1000).toFixed(3);
}

export default function Calculatrice({ avecFodecParDefaut, onClose }) {
  const [avecFodec, setAvecFodec] = useState(avecFodecParDefaut !== false);
  const [htInput, setHtInput] = useState("");
  const [ttcInput, setTtcInput] = useState("");
  // Quelle case l'utilisateur a saisie en dernier : c'est elle qui fait
  // autorite, l'autre est recalculee a partir de sa valeur.
  const [source, setSource] = useState(null); // "ht" | "ttc" | null

  const resultat = useMemo(() => {
    if (source === "ttc") return depuisTtc(ttcInput, avecFodec);
    if (source === "ht") return depuisHt(htInput, avecFodec);
    return null;
  }, [source, htInput, ttcInput, avecFodec]);

  // Met a jour la case opposee (et la recalcule si le FODEC est bascule)
  // sans jamais toucher a la case que l'utilisateur est en train de saisir.
  useEffect(() => {
    if (source === "ht") setTtcInput(resultat ? fmtChamp(resultat.ttc) : "");
    else if (source === "ttc") setHtInput(resultat ? fmtChamp(resultat.ht) : "");
  }, [resultat, source]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal calc-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Convertisseur P.H.T / P.T.T.C</h2>
        <p className="subtitle calc-subtitle">
          Un outil de saisie rapide, séparé de la facture en cours : rien ici n'est enregistré ni ajouté à la
          facture. Tapez dans l'une des deux cases, l'autre se met à jour automatiquement.
        </p>

        <div className="calc-radio-group">
          <label className="checkbox-row">
            <input type="radio" name="calc-fodec" checked={avecFodec} onChange={() => setAvecFodec(true)} />
            Avec FODEC ({TAUX_FODEC * 100}%)
          </label>
          <label className="checkbox-row">
            <input type="radio" name="calc-fodec" checked={!avecFodec} onChange={() => setAvecFodec(false)} />
            Sans FODEC
          </label>
        </div>

        <div className="grid-2">
          <label>
            P.H.T (DT)
            <input
              type="number"
              min="0"
              step="any"
              autoFocus
              value={htInput}
              onChange={(e) => {
                setSource("ht");
                setHtInput(e.target.value);
              }}
              onFocus={(e) => e.target.select()}
              placeholder="0.000"
            />
          </label>
          <label>
            P.T.T.C (DT)
            <input
              type="number"
              min="0"
              step="any"
              value={ttcInput}
              onChange={(e) => {
                setSource("ttc");
                setTtcInput(e.target.value);
              }}
              onFocus={(e) => e.target.select()}
              placeholder="0.000"
            />
          </label>
        </div>

        <div className="totaux-preview calc-result">
          <div className={source === "ttc" ? "calc-reponse" : ""}>
            <span>P.T.H.T</span>
            <span>{fmt(resultat?.ht)} DT</span>
          </div>
          {avecFodec && (
            <div>
              <span>FODEC {TAUX_FODEC * 100}%</span>
              <span>{fmt(resultat?.fodec)} DT</span>
            </div>
          )}
          <div>
            <span>T.V.A {TAUX_TVA * 100}%</span>
            <span>{fmt(resultat?.tva)} DT</span>
          </div>
          <div className={`ttc ${source === "ht" ? "calc-reponse" : ""}`}>
            <span>TOTAL T.T.C</span>
            <span>{fmt(resultat?.ttc)} DT</span>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
