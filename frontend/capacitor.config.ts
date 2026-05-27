import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.socialmedia.inbox',
  appName: 'SocialMedia Inbox',
  webDir: 'public',

  // Load the live hosted app instead of bundled static files.
  // To build a fully offline APK later, remove the server block
  // and run: next build + next export, then npx cap sync.
  server: {
    url: 'https://workspace.saraloms.com',
    cleartext: false,
  },

  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },

  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
  },
};

export default config;
