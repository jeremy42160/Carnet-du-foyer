import { useEffect, useState, useCallback } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { getDeviceId } from "../deviceId";

// Synchronise une collection Firestore en temps réel : plus besoin de rafraîchissement
// manuel ni de risque d'écraser les données, Firestore pousse les mises à jour dès
// qu'un des deux téléphones modifie quelque chose.
export function useCollection(name) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, name),
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
  }, [name]);

  const add = useCallback(
    async (data) => {
      const id = crypto.randomUUID();
      await setDoc(doc(db, name, id), { ...data, id, createdByDevice: getDeviceId(), createdAt: serverTimestamp() });
      return id;
    },
    [name]
  );

  const update = useCallback(
    async (id, data) => {
      await setDoc(doc(db, name, id), data, { merge: true });
    },
    [name]
  );

  const remove = useCallback(
    async (id) => {
      await deleteDoc(doc(db, name, id));
    },
    [name]
  );

  return { items, ready, add, update, remove };
}
