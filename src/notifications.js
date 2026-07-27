import { doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { getToken, deleteToken } from "firebase/messaging";
import { db, VAPID_KEY, getMessagingIfSupported } from "./firebase";
import { getDeviceId } from "./deviceId";

export const NOTIF_CATEGORIES = [
  { id: "taches", label: "Tâches (dont Travail et Amis)" },
  { id: "courses", label: "Courses" },
  { id: "valise", label: "Valises" },
  { id: "activites", label: "Activités" },
  { id: "repas", label: "Repas" },
];
const DEFAULT_CATEGORIES = { taches: true, courses: true, valise: true, activites: true, repas: true };

// Demande la permission, récupère le token FCM et l'enregistre dans Firestore
// (collection "devices") pour que la fonction serverless puisse envoyer des
// notifications à cet appareil. Les préférences par catégorie démarrent toutes activées.
export async function enableNotifications(personName) {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("Ce navigateur ne supporte pas les notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permission refusée.");
  }
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const messaging = await getMessagingIfSupported();
  if (!messaging) throw new Error("Messagerie non supportée sur cet appareil.");

  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  const deviceId = getDeviceId();
  await setDoc(doc(db, "devices", deviceId), {
    token,
    person: personName || "Inconnu",
    categories: DEFAULT_CATEGORIES,
    updatedAt: Date.now(),
  });
  return token;
}

export async function disableNotifications() {
  const deviceId = getDeviceId();
  try {
    const messaging = await getMessagingIfSupported();
    if (messaging) await deleteToken(messaging);
  } catch {
    // pas grave si le token n'existait plus côté FCM
  }
  await deleteDoc(doc(db, "devices", deviceId));
}

// Récupère le document de l'appareil courant (pour lire ses préférences actuelles).
export async function getMyDevice() {
  const deviceId = getDeviceId();
  const snap = await getDoc(doc(db, "devices", deviceId));
  return snap.exists() ? snap.data() : null;
}

// Active/désactive les notifications pour une catégorie donnée, sur cet appareil.
export async function setCategoryPref(category, enabled) {
  const deviceId = getDeviceId();
  await setDoc(doc(db, "devices", deviceId), { categories: { [category]: enabled } }, { merge: true });
}
