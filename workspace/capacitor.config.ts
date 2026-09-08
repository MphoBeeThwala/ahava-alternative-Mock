import type { CapacitorConfig } from '@capacitor/cli';

// The app ships as a thin native shell around the existing Next.js web app
// (cookie-session auth, WebSocket, and the /api proxy all assume a real
// server — there is no static-export path here). `server.url` points the
// WebView straight at the deployed app instead of bundling a copy of it, so
// the mobile app and the web app are always running identical code.
//
// Override at build time for local development against a dev server:
//   CAPACITOR_SERVER_URL=http://10.0.2.2:3000 npx cap sync
// (10.0.2.2 is the Android emulator's alias for the host machine's
// localhost; an iOS simulator can use localhost directly.)
const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://app.ahavaon88.co.za';

const config: CapacitorConfig = {
  // Matches android/app/build.gradle's existing applicationId/namespace —
  // this native project predates this config and must not get a new one.
  appId: 'co.za.ahavahealthcare.app',
  appName: 'Ahava',
  // Required by the Capacitor CLI even though server.url overrides it at
  // runtime — this is only what ships inside the native binary as a
  // same-origin fallback shell if the remote URL is briefly unreachable.
  // Deliberately not Next.js's own public/: that folder is served by the
  // live web app, and this placeholder has nothing to do with it.
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
