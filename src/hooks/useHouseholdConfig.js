import { useEffect, useState, useCallback } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";

// Champs de repas par défaut, utilisés tant qu'un foyer n'a rien personnalisé
// dans Repas → Paramétrage.
export const DEFAULT_MEAL_FIELDS = [
  { id: "table", label: "Mettre la table", counted: true },
  { id: "debarrasser", label: "Débarrasser la table", counted: true },
  { id: "yaourts", label: "Chercher les yaourts", counted: true },
];

// Le foyer "default" (Jerem & Jennifer) garde ses enfants et métiers déjà en place —
// jamais de question, jamais de bascule possible pour ces deux points précis. En
// revanche, les champs de repas (Paramétrage) restent personnalisables pour TOUS
// les foyers, y compris celui-ci.
export const DEFAULT_HOUSEHOLD_CONFIG = {
  hasKids: true,
  kids: [
    { name: "Noé", color: "#5B4B8A" },
    { name: "Thaïs", color: "#C1683C" },
    { name: "Alba", color: "#3E6E63" },
  ],
  hasWork: true,
  workers: [
    { name: "Jennifer", icon: "🩺" },
    { name: "Jerem", icon: "💳" },
  ],
};

// hasKids/hasWork valant `null` signifie "pas encore configuré" — c'est ce qui
// déclenche l'écran de première configuration pour un nouveau foyer.
const EMPTY_CONFIG = { hasKids: null, kids: [], hasWork: null, workers: [] };

export function useHouseholdConfig(householdId) {
  // Ce qui est réellement stocké dans Firestore (mealFields pour tous les foyers,
  // et pour les foyers autres que "default" : hasKids/kids/hasWork/workers aussi).
  const [stored, setStored] = useState(null);
  const [loading, setLoading] = useState(true);
  // Permet un affichage immédiat après l'onboarding, sans attendre l'aller-retour
  // Firestore (voir App.jsx) — réinitialisé dès qu'une vraie donnée arrive.
  const [localOverride, setLocalOverride] = useState(null);

  useEffect(() => {
    if (!householdId) return;
    setLoading(true);
    const ref = doc(db, "households", householdId, "meta", "config");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setStored(snap.exists() ? snap.data() : {});
        setLocalOverride(null);
        setLoading(false);
      },
      (err) => {
        console.error("Erreur de configuration du foyer", err);
        setLoading(false);
      }
    );
    return unsub;
  }, [householdId]);

  const save = useCallback(
    async (partial) => {
      if (!householdId) return;
      const ref = doc(db, "households", householdId, "meta", "config");
      await setDoc(ref, partial, { merge: true });
    },
    [householdId]
  );

  let config = null;
  if (stored !== null) {
    const effective = localOverride || stored;
    if (householdId === "default") {
      // Enfants et métiers toujours fixes pour ce foyer, quoi qu'il y ait dans
      // Firestore ; seuls les champs de repas peuvent y être personnalisés.
      config = { ...DEFAULT_HOUSEHOLD_CONFIG, mealFields: effective.mealFields && effective.mealFields.length ? effective.mealFields : DEFAULT_MEAL_FIELDS };
    } else {
      config = { ...EMPTY_CONFIG, ...effective };
      if (config.hasKids && (!config.mealFields || !config.mealFields.length)) {
        config.mealFields = DEFAULT_MEAL_FIELDS;
      } else if (!config.mealFields) {
        config.mealFields = [];
      }
    }
  }

  return { config, loading: loading || stored === null, save, setConfig: setLocalOverride };
}

