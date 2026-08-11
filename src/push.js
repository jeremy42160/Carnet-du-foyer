import { getDeviceId } from "./deviceId";

// Appelle la fonction serverless Vercel (/api/notify) juste après l'ajout d'un
// élément, pour prévenir l'autre personne DU MÊME FOYER. N'échoue jamais
// bruyamment : si la notification ne part pas, l'élément est déjà bien
// enregistré dans Firestore.
export async function sendPush(title, body, category, householdId) {
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, excludeDeviceId: getDeviceId(), category, householdId }),
    });
  } catch (e) {
    console.error("Erreur d'envoi de notification", e);
  }
}
