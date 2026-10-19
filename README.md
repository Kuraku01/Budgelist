# Budgelist 🚀 `v1.0.0-beta`

> Log spending, catch recurring bills, and forecast your monthly budget with local-first offline speed and seamless cloud synchronization.

Budgelist is a modern, responsive personal finance and budgeting application built with plain HTML5, CSS3, and JavaScript, packaged with Capacitor for native Android deployment and powered by Firebase (Auth + Firestore).

---

## ✨ Features

### ⚡ Local-First & Offline Architecture
- **Instant 0ms App Startup**: Logged-in users load their budget, expenses, and forecast instantly from local cache without waiting for network calls.
- **Offline Mutations**: Add, edit, or delete expenses, recurring bills, and budget targets completely offline. Changes are stored in a local sync queue and automatically pushed to the cloud when connected.

### 🔄 Realtime Cloud Sync & Pull-to-Refresh
- **Multi-Device Synchronization**: Syncs expenses, recurring bills, and budget settings across all your mobile and web devices.
- **Pull-to-Refresh Gesture**: Swipe down from the top of the screen anytime to pull and fetch the latest cloud data.
- **Manual & Auto Sync Modes**: Choose between automatic background sync or manual sync via the topbar controls.

### 👤 Guest Account Mode
- **Instant Guest Access**: Jump straight into budgeting without creating an account.
- **Data Safety Warning**: Displays a confirmation modal explaining local storage persistence before entering guest mode.

### 🔑 Username & Email Authentication
- **Unique Username Signup**: Choose a unique username during registration.
- **Flexible Login**: Sign in using either your email address or unique username.
- **Email Verification**: Unverified cloud accounts receive an email verification prompt with a quick resend option.

### 📶 Realtime Network Monitor
- **Background Network Detection**: Continuously checks connectivity status in the background.
- **Floating Status Banner**: Displays a floating status pill with a red X mark when offline (*"Offline — changes saved locally"*) and transitions to a green checkmark (*"Connection restored — synced!"*) when internet is restored.
- **Network Retry Modal**: Protects cloud login and signup with an interactive Retry/Cancel modal when offline.

### ⚙️ Compact Accordion Settings
- **Space-Saving Category Accordions**: Collapsible sections for Profile, Appearance, Sync Options, Export, About, and Account actions.
- **Profile Customization**: Choose from 5 preset avatars (`🦊`, `🐱`, `🚀`, `💎`, `👤`) and save your display name.
- **About & Release Notes**: Check for updates and view full `v1.0.0-beta` release notes inside settings.

### 📊 Hand-Drawn Inline SVG Charts
- **Zero External Dependencies**: Fast, lightweight inline SVG rendering that works 100% offline.
- **Category Breakdown**: Toggle between Donut Chart and Bar Chart views.
- **Least-Squares Forecast**: Calculates a least-squares trendline across cumulative daily spending to project end-of-month budget targets.

### 💾 Native Android CSV Export
- **Android MediaStore Integration**: Export monthly expenses directly into the Android device's **Downloads** folder using native Java bridge APIs.

---

## 🛠️ Project Structure

```
android/                  Native Android Studio project (Capacitor wrapper)
  app/src/main/
    java/.../MainActivity.java  Native Android bridge (MediaStore file exporter & Web interface)
    assets/public/        Web app assets (HTML, CSS, JS, Firebase config)
www/                      Web source assets (synced with Capacitor)
  index.html              UI structure (screens, sheets, modals, status banners, settings accordions)
  style.css               Budgelist visual identity & light/dark design system
  app.js                  Sync engine, auth logic, local cache, gesture handlers, chart rendering
  firebase-config.js      Firebase project keys
firestore.rules           Firestore security rules (user isolation & username lookup)
capacitor.config.json     Capacitor project configuration
```

---

## 🚀 Setup & Installation

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com) and create a project.
2. Enable **Authentication** -> **Email/Password**.
3. Enable **Firestore Database** in production mode.
4. Go to **Project Settings -> Web App (</>)**, copy your `firebaseConfig` object, and paste it into `www/firebase-config.js` and `android/app/src/main/assets/public/firebase-config.js`.
5. In Firestore **Rules**, paste the contents of `firestore.rules` and click **Publish**.

### 2. Local Web Development

```bash
# Serve locally via npm or python
npx serve www
# or: cd www && python3 -m http.server 8080
```

### 3. Android Native Build (Capacitor)

```bash
# Install dependencies
npm install

# Copy web assets to Android native project
npx cap sync android

# Open project in Android Studio
npx cap open android
```

Run `assembleDebug` or deploy directly to your device/emulator from Android Studio.

---

## 📝 License & Authors

Developed with ❤️ by **Kuraku & Budgelist Team**.  
Built for personal finance tracking with privacy and local speed in mind.
