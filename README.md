# Budgelist

Budgelist is a privacy-focused personal expense tracker and monthly budgeting application. It combines local-first offline performance with cloud synchronization across web and Android devices.

The application is built with standard web technologies (HTML5, CSS3, JavaScript ES6+), powered by Firebase (Authentication and Firestore), and wrapped as a native mobile application using Capacitor.

---

## Features

### Local-First Performance and Offline Support
- **Instant Launch**: Loads expenses, recurring bills, and budget data instantly from local storage without blocking on network requests.
- **Offline Mutations**: Add, edit, or delete entries offline. Changes are saved locally and queued for automatic synchronization when a connection becomes available.

### Cloud Sync and Pull-to-Refresh
- **Cross-Device Syncing**: Keeps expenses and budget targets consistent across multiple devices.
- **Pull-to-Refresh Gesture**: Swipe down from the top of the main view to sync and fetch the latest cloud data.
- **Configurable Sync Modes**: Toggle between automatic background synchronization and manual sync.

### Guest Mode
- **Instant Access**: Use the application without registering an account.
- **Local Persistence**: Guest data remains isolated on the device in local storage with an initial confirmation warning regarding data scope.

### Authentication
- **Unique Username Signup**: Registration requires a unique username alongside email and password.
- **Flexible Login**: Sign in using either an email address or username.
- **Email Verification**: Prompts unverified accounts with an option to resend verification emails.

### Real-Time Network Monitoring
- **Background Connection Checks**: Continuously monitors network availability.
- **Status Indicator**: Displays a floating banner when offline ("Offline — changes saved locally") and transitions to a brief confirmation when connectivity is restored ("Connection restored — synced!").
- **Offline Guard**: Prevents failed authentication attempts when offline and prompts the user with retry or guest access options.

### Settings and Profile Customization
- **Accordion Organization**: Compact settings layout organized into collapsible categories (Profile, Appearance, Sync Options, Export, About, and Account).
- **Profile Presets**: Customize display name and avatar presets.
- **Release Notes and Updates**: View release notes and version information within the About section.

### Lightweight SVG Charts
- **Dependency-Free Visualizations**: Hand-drawn inline SVG charts for category breakdowns (Donut and Bar views) and monthly spending trends.
- **Spending Forecast**: Calculates a least-squares linear regression trendline across cumulative daily spending to project end-of-month totals against budget limits.

### Native Android Integration
- **Direct CSV Export**: Saves monthly expense reports directly into the Android device's Downloads directory using Android MediaStore APIs.

---

## Project Structure

```
android/                  Native Android project wrapped via Capacitor
  app/src/main/
    java/.../MainActivity.java  Native Android bridge for file export
    assets/public/        Compiled web assets for native deployment
www/                      Web application source files
  index.html              Main application markup and overlays
  style.css               Design system and theme styles
  app.js                  Sync engine, state management, and chart logic
  firebase-config.js      Firebase project configuration keys
firestore.rules           Firestore security and data access rules
capacitor.config.json     Capacitor configuration file
```

---

## Setup and Installation

### 1. Firebase Setup

1. Create a project in the [Firebase Console](https://console.firebase.google.com).
2. Enable **Authentication** with the **Email/Password** provider.
3. Create a **Firestore Database** in production mode.
4. Register a Web App, copy your `firebaseConfig` object, and place it in `www/firebase-config.js` and `android/app/src/main/assets/public/firebase-config.js`.
5. Apply the rules from `firestore.rules` in your project's Firestore Security Rules tab.

### 2. Local Web Development

Serve the `www/` directory using any local web server:

```bash
npx serve www
# or: cd www && python3 -m http.server 8080
```

### 3. Android Build with Capacitor

```bash
# Install dependencies
npm install

# Sync web assets to the Android platform
npx cap sync android

# Open in Android Studio
npx cap open android
```

Build or run the application on an emulator or connected device via Android Studio.

---

## License and Attribution

Budgelist is developed by the Kuraku team. Designed for personal budgeting with an emphasis on speed, reliability, and data privacy.
