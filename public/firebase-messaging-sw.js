/* Optional push worker. It has no fetch handler and does not take control of wedding pages.
   Firebase starts only after the page sends the public web config. */
self.addEventListener("install", () => self.skipWaiting());

let started = false;

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "wc-fcm-config" || started) return;
  if (!data.apiKey || !data.projectId || !data.messagingSenderId || !data.appId) return;
  importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");
  firebase.initializeApp({
    apiKey: data.apiKey,
    authDomain: data.authDomain || undefined,
    projectId: data.projectId,
    messagingSenderId: data.messagingSenderId,
    appId: data.appId,
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Wedding Circle";
    const body = payload.notification?.body || "";
    self.registration.showNotification(title, { body });
  });
  started = true;
});
