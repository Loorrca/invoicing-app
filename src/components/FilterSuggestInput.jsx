import React, { useRef, useState } from "react";

// Champ texte libre avec suggestions filtrees en dessous au fur et a mesure
// de la frappe (meme principe visuel que SearchableSelect), mais SANS
// forcer le choix d'un element de la liste : contrairement a
// SearchableSelect, la valeur affichee EST le texte tape lui-meme (`value`/
// `onChange` classiques d'un champ libre), pas l'id d'un element choisi
// quelque part dans `items`. Cliquer une suggestion appelle `onPick(item)`
// (qui peut re-remplir d'autres champs, comme le code/prix d'un article) ;
// continuer a taper sans rien choisir laisse simplement le texte libre tel
// quel, sans aucun effet de bord. Utilise pour la designation des lignes de
// facture (src/pages/NewInvoice.jsx) : on tape le debut du nom d'un article
// pour le retrouver vite, sans etre oblige de l'ecrire en entier, tout en
// gardant la possibilite de personnaliser ou saisir un libelle inedit.
//
// `items`             : tableau de donnees brutes (articles).
// `getLabel`/`getCode`: accesseurs pour le libelle principal/secondaire
//                       affiches dans la liste ("Libelle (code)").
// `value`/`onChange`  : texte libre classique.
// `onPick(item)`      : appele quand une suggestion est choisie (clic ou
//                       Entree sur l'option mise en avant).
export default function FilterSuggestInput({
  value,
  onChange,
  items,
  getLabel,
  getCode = () => "",
  onPick,
  placeholder,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const closeTimer = useRef(null);

  const q = (value || "").trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => {
        const label = (getLabel(i) || "").toLowerCase();
        const code = (getCode(i) || "").toLowerCase();
        return label.includes(q) || code.includes(q);
      })
    : items;
  const effectiveHighlight = Math.min(highlight, Math.max(filtered.length - 1, 0));

  function openList() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
  }

  function choose(item) {
    if (!item) return;
    onPick(item);
    closeList();
  }

  function labelOf(item) {
    const code = getCode(item);
    return code ? `${getLabel(item)} (${code})` : getLabel(item);
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openList();
        setHighlight(0);
      }
      return;
    }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // N'intercepte Entree que si une suggestion est bien mise en avant :
      // sur un libelle entierement libre (aucune correspondance), Entree
      // garde son comportement normal (ex. soumettre le formulaire).
      if (filtered[effectiveHighlight]) {
        e.preventDefault();
        choose(filtered[effectiveHighlight]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    }
  }

  return (
    <div className="searchable-select">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          openList();
        }}
        onFocus={openList}
        onBlur={() => {
          // Petit delai pour laisser le clic sur une suggestion (onMouseDown)
          // s'executer avant que la liste ne se referme.
          closeTimer.current = setTimeout(closeList, 120);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="searchable-select-list">
          {filtered.map((item, idx) => (
            <li
              key={`${getCode(item) || ""}|${getLabel(item)}|${idx}`}
              className={"searchable-select-option" + (idx === effectiveHighlight ? " highlight" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setHighlight(idx)}
            >
              {labelOf(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
