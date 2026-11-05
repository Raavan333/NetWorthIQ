import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.networthiq.app',
  appName: 'NetWorthIQ',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
