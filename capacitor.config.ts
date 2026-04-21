import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'co.za.ahavahealthcare.app',
  appName: 'Ahava Healthcare',
  webDir:  'dist/client',   // Vite build output (vite.config.ts → build.outDir)

  server: {
    // During development, point to local Vite dev server
    // Comment out for production builds
    // url: 'http://10.0.2.2:3000',  // Android emulator → host machine
    androidScheme: 'https',
  },

  android: {
    // Required for Health Connect data privacy policy
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    HealthConnect: {
      // Declare which record types to request permission for
      // This must match the PERMISSIONS array in healthConnectService.ts
    },
  },
};

export default config;
