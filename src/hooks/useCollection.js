import { useEffect, useState, useCallback } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { getDeviceId } from "../deviceId";

// Le foyer "default" (Jerem & Jennifer) utilise directement les collections déjà
// existantes (aucune donnée à migrer). Tout nouveau foyer créé via "Créer mon
// compte" utilise un sous-dossier dédié, isolé des autres foyers.
function collectionRef(name, householdId) {
  if (!householdId || householdId === "default") {
    return collection(db, name);
  }
  return collection(db, "households", householdId, name);
}
function docRef(name, householdId, id) {
  if (!householdId || householdId === "default") {
    return doc(db, name, id);
  }
  return doc(db, "households", householdId, name, id);
}

// Synchronise une collection Firestore en temps réel : plus besoin de rafraîchissement
// manuel ni de risque d'écraser les données, Firestore pousse les mises à jour dès
// qu'un des deux téléphones modifie quelque chose.
export function useCollection(name, householdId) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    setReady(false);
    const unsub = onSnapshot(
      collectionRef(name, householdId),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setItems(list);
        setReady(true);
      },
      (err) => {
        console.error(`Erreur de synchronisation (${name})`, err);
      }
    );
    return unsub;
  }, [name, householdId]);

  const add = useCallback(
    async (data) => {
      const id = crypto.randomUUID();
      await setDoc(docRef(name, householdId, id), { ...data, id, createdByDevice: getDeviceId(), createdAt: serverTimestamp() });
      return id;
    },
    [name, householdId]
  );

  const update = useCallback(
    async (id, data) => {
      await setDoc(docRef(name, householdId, id), data, { merge: true });
    },
    [name, householdId]
  );

  const remove = useCallback(
    async (id) => {
      await deleteDoc(docRef(name, householdId, id));
    },
    [name, householdId]
  );

  return { items, ready, add, update, remove };
}
