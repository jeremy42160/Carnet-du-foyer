/* Service worker : reçoit les notifications push en arrière-plan (app fermée ou en veille)
   et met en cache les fichiers de base pour un chargement plus rapide.

   ⚠️ Remplacez firebaseConfig ci-dessous par la config de VOTRE projet Firebase
   (Console Firebase → Paramètres du projet → Vos applications → config).
   Elle doit être IDENTIQUE à celle de src/firebase.js. */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBK0XE4AInFTxrDTU9YiccuW5DzbFRSyPQ",
  authDomain: "carnet-du-foyer.firebaseapp.com",
  projectId: "carnet-du-foyer",
  storageBucket: "carnet-du-foyer.appspot.com",
  messagingSenderId: "1049902629118",
  appId: "1:1049902629118:web:06cd2097a9237873cb65af",
});

const messaging = firebase.messaging();

// Notification affichée quand l'appli est fermée ou en arrière-plan
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Le carnet du foyer";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [100, 50, 100],
  };
  self.registration.showNotification(title, options);
});

// Ouvre/ramène l'appli au clic sur la notification
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});

// Cache minimal pour un chargement hors-ligne de la coquille de l'appli
const CACHE_NAME = "carnet-du-foyer-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/manifest.json", "/icons/icon-192.png"]))
  );
});
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
