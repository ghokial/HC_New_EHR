import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.healthcarology.patient',
  appName: 'Healthcarology Patient',
  webDir: 'www',
  backgroundColor: '#0047AB',
  android: { allowMixedContent: false, backgroundColor: '#0047AB' },
  ios: { backgroundColor: '#0047AB', contentInset: 'automatic', preferredContentMode: 'mobile' },
  plugins: {
    SplashScreen: { launchShowDuration: 1800, backgroundColor: '#0047AB', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#FFFFFF' },
    Keyboard: { resize: 'body', resizeOnFullScreen: true }
  }
};
export default config;
