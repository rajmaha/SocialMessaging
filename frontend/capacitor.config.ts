import { CapacitorConfig } from '@capacitor/cli';

// Where the shell loads the frontend from. Defaults to the hosted app; set
// CAP_SERVER_URL to preview local work on a device or simulator, e.g.
//
//   CAP_SERVER_URL=http://localhost:3000 npx cap sync ios
//
// `cap sync` bakes this into ios/App/App/capacitor.config.json and the
// Android equivalent, both of which are tracked — re-run sync without the
// variable before committing, or you ship a build pointing at a laptop.
const SERVER_URL = process.env.CAP_SERVER_URL || 'https://workspace.saraloms.com';
const serverHost = new URL(SERVER_URL).hostname;

const config: CapacitorConfig = {
  appId: 'com.socialmedia.inbox',
  appName: 'SocialMedia Inbox',
  webDir: 'public',

  // Load the live hosted app instead of bundled static files.
  // To build a fully offline APK later, remove the server block
  // and run: next build + next export, then npx cap sync.
  server: {
    url: SERVER_URL,
    // Only ever true for a local http:// preview; the hosted app is https.
    cleartext: SERVER_URL.startsWith('http://'),
    // Deep links and the hosted app share this hostname, so navigation
    // within it stays in the WebView; anything else opens in the browser.
    allowNavigation: [serverHost],
  },

  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },

  ios: {
    // 'never' because the app draws its own safe-area padding (--sa-top /
    // --sa-bottom in globals.css); 'automatic' would add a second inset on
    // top of ours and leave a dead band under the status bar.
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },

  plugins: {
    SplashScreen: {
      // NativeShell calls SplashScreen.hide() as soon as the native bridge is
      // ready, so normally the splash lasts only as long as the first paint.
      //
      // launchAutoHide stays TRUE on purpose: the app loads a *hosted*
      // frontend, so a deploy that predates NativeShell (or is rolled back)
      // would have nothing to call hide() and the app would sit on the splash
      // until the timeout. Auto-hide makes a stale frontend cost 3 seconds
      // instead of hanging.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#ffffffff',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },

    Keyboard: {
      // Shrink the WebView so the composer sits on top of the keyboard
      // instead of being scrolled out of view.
      resize: 'native',
      resizeOnFullScreen: true,
    },

    PushNotifications: {
      // Show the OS banner even while the app is in the foreground; the
      // in-app toast and the banner are de-duplicated in NativeShell.
      presentationOptions: ['badge', 'sound', 'alert'],
    },

    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#2563eb',
    },
  },
};

export default config;
