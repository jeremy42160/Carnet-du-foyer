import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { getToken, deleteToken } from "firebase/messaging";
import { db, VAPID_KEY, getMessagingIfSupported } from "./firebase";
import { getDeviceId } from "./deviceId";

// Demande la permission, récupère le token FCM et l'enregistre dans Firestore
// (collection "devices") pour que la Cloud Function puisse envoyer des notifications
// à cet appareil.
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
