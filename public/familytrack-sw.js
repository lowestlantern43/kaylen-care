self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "FamilyTrack reminder",
      body: event.data ? event.data.text() : "You have a reminder.",
    };
  }

  const title = payload.title || "FamilyTrack reminder";
  const options = {
    body: payload.body || "Open FamilyTrack to view the reminder.",
    icon: "/familytrack-care-icon-192.png",
    badge: "/familytrack-care-icon-192.png",
    tag: payload.tag || `familytrack-${payload.type || "reminder"}`,
    renotify: true,
    data: {
      url: payload.url || "/",
      type: payload.type || "reminder",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find(
          (client) => new URL(client.url).origin === targetUrl.origin,
        );

        if (existingClient) {
          existingClient.focus();
          existingClient.navigate(targetUrl.href);
          return;
        }

        return self.clients.openWindow(targetUrl.href);
      }),
  );
});
