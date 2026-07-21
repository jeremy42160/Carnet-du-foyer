// Un identifiant stable par appareil/navigateur, utilisé pour que la Cloud Function
// n'envoie pas de notification à la personne qui vient elle-même d'ajouter l'élément.
export function getDeviceId() {
  let id = localStorage.getItem("carnet-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("carnet-device-id", id);
  }
  return id;
}
