import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        });
        }

        export default async function handler(req, res) {
          if (req.method !== "POST") {
              res.status(405).json({ error: "Méthode non autorisée" });
                  return;
                    }

                      try {
                          const { title, body, excludeDeviceId } = req.body;
                              if (!title || !body) {
                                    res.status(400).json({ error: "title et body sont requis" });
                                          return;
                                              }

                                                  const db = admin.firestore();
                                                      const devicesSnap = await db.collection("devices").get();
                                                          const tokens = devicesSnap.docs
                                                                .filter((d) => d.id !== excludeDeviceId)
                                                                      .map((d) => d.data().token)
                                                                            .filter(Boolean);

                                                                                if (tokens.length === 0) {
                                                                                      res.status(200).json({ sent: 0 });
                                                                                            return;
                                                                                                }

                                                                                                    const result = await admin.messaging().sendEachForMulticast({
                                                                                                          tokens,
                                                                                                                notification: { title, body },
                                                                                                                      webpush: { fcmOptions: { link: "/" } },
                                                                                                                          });

                                                                                                                              res.status(200).json({ sent: result.successCount });
                                                                                                                                } catch (e) {
                                                                                                                                    console.error("Erreur d'envoi de notification", e);
                                                                                                                                        res.status(500).json({ error: e.message });
                                                                                                                                          }
                                                                                                                                          }