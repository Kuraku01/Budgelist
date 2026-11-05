# Budgelist

![Version](https://img.shields.io/badge/version-0.2.0--beta-purple.svg)
![Platform](https://img.shields.io/badge/platform-Android-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Offline Support](https://img.shields.io/badge/offline-100%25%20supported-brightgreen.svg)

**Budgelist** is a privacy-focused personal expense tracker, two-tier budgeting application, and financial forecasting tool. It combines local-first offline performance with real-time cloud synchronization across devices.

The application allows users to manage an overall Budget pool, allocate monthly budgets, log daily expenses, track recurring bills, convert between global currencies using live exchange rates, and view multi-factor trend-line forecasts predicting end-of-month budget adherence.

---

## What's New in v0.2.1-beta

- **Multi-Layer Android Back Navigation**: Native `OnBackPressedCallback` captures back gestures and physical back buttons, closing open UI elements sequentially (custom dropdowns &rarr; date/calendar popovers &rarr; modals &rarr; secondary sheets &rarr; base sheets &rarr; auth sub-views) with double-back confirmation to exit on the root screen.
- **Dual-Channel Live OTA Engine (`dist.zip` vs. `dist-unstable.zip`)**: Explicit Stable and Testing/Unstable OTA channels, non-blocking startup checks with Confirm/Later prompt, and an integrated **Update Center** in Settings &rarr; About with individual track statuses and a **Revert to Built-in Native Package** option.
- **Rate-Limit-Free CDN Update Manifest**: Release discovery directly queries CDN-hosted `ota-manifest.json` and GitHub web endpoints, completely bypassing GitHub's 60 req/hr unauthenticated REST API limit, backed by a 10-minute cooldown on background startup checks.
- **Automatic Native APK Cache Invalidation**: Native APK timestamp tracking (`PackageInfo.lastUpdateTime`) automatically purges stale cached web bundles when a new or rebuilt APK is installed.

---

## What's New in v0.2.0-beta

- **Two-Tier Global & Monthly Budget System**: Manage an accessible Global Budget pool with a persistent **Budget History** ledger (optional descriptions, individual entry deletion, and log-only vs. full-reset options), and lend monthly budgets via synchronized manual input, smooth animated slider (with spent-floor indicators), and percentage chips (`25%`, `50%`, `75%`, `MAX`).
- **Automatic Past-Month Settlement & Historical Lock**: When a month concludes, unspent monthly budget automatically returns once to your Global Budget. Past months lock by default to preserve historical records (with optional unlock for historical edits without affecting current Budget).
- **Interactive Calendar & Custom Expense Date Picker**: Navigate seamlessly from 1970 to 50 years into the future with auto-expanding year dropdowns, day-level filtering, and a custom dropdown calendar in the Add/Edit Expense sheet.
- **6 Color Themes & Native UI Polish**: Customize appearance with 6 color themes (**Violet**, **Emerald**, **Ocean**, **Rose**, **Sunset**, and **Slate**) across Light and Dark modes, tactile 3D FAB depth, and app-wide text selection prevention.
- **Upgraded Forecast Engine & Multi-Tier Warnings**: Multi-factor forecasting incorporating upcoming unpaid recurring bills and multi-month spend velocity baselines, Safe Daily Spend Targets, and 3-tier budget risk warnings (`safe`, `caution`, `critical`).
- **Universal Live OTA Engine & Security Hardening**: Full HTML/CSS/JS over-the-air bundle updates, upgraded Capacitor 8.6.0 & AGP 9.5.0, zero npm vulnerabilities, and hardened CSV export path validation.

---

## Key Capabilities

### Local-First Architecture & Offline Performance

- **Zero-Delay Startup**: Launches instantly from local storage without blocking on network requests or server availability.
- **Offline Data Persistence**: Add, edit, or delete expenses and recurring bills offline. All mutations persist locally and automatically synchronize when a network connection is established.
- **Guest Access**: Full application functionality is available offline without requiring account registration.
- **Automatic Schema Migrations**: Safe, versioned schema migrations maintain local database integrity when data formats change across application versions.

### Over-The-Air (OTA) Live Updates & Update Management

- **Zero-Friction Web OTA Updates**: Background web bundle updater automatically downloads and applies `dist.zip` assets (HTML, CSS, and JS) attached to GitHub Releases.
- **Loading Screen Progress Indicator**: Displays real-time download percentage and extraction progress bar when a new web update is detected on boot.
- **Mandatory vs. Optional Update Controls**: Differentiates breaking version changes from optional minor patches to ensure API compatibility without unnecessary user friction.

### Multi-Currency Management & Live Exchange Rates

- **Global Currency Support**: Native support for major global currencies including USD ($), EUR (€), GBP (£), JPY (¥), PHP (₱), AUD (A$), CAD (C$), INR (₹), BRL (R$), and CHF (Fr).
- **Automated Rate Conversion**: Fetches live exchange rates and converts all existing expenses, recurring bills, and budget targets to any selected target currency.
- **Atomic Database Sync**: Currency conversions are committed to the database using atomic batch operations to ensure data integrity across devices.

### Financial Forecasting & Analytics

- **Visual Category Distribution**: Provides inline vector charts (Donut and Bar views) for spending category breakdowns.
- **Multi-Factor Forecast**: Combines historical variable velocity, current month pace, and scheduled unpaid recurring bills to project end-of-month totals against monthly or global budget limits.

### Privacy, Security & Code Quality

- **Isolated User Storage**: Data access is restricted to authenticated account owners via server-enforced security policies.
- **Content Security Policy (CSP)**: Enforces strict resource origin controls for Firebase Auth, Google APIs, WebSocket streams, and GitHub Releases API.
- **XSS & Credential Protection**: Eliminates unsanitized `innerHTML` sinks in dynamic list rendering, prevents raw password persistence in local storage, and validates native CSV export filenames against path traversal.

### Native Android Features

- **CSV Data Export**: Export monthly expense records directly to the device's Downloads directory in standard CSV format.
- **Theme & Color Palette Integration**: Supports Light and Dark modes paired with 6 customizable color themes.

---

## Installation & Setup

### Installing the Android Application

1. Navigate to the [Releases](https://github.com/Kuraku01/Budgelist/releases) page of this repository.
2. Download the latest `Budgelist_0.2.1-beta.apk` asset.
3. Open the downloaded file on your Android device to complete installation.

### Developer Setup & Building From Source

To build and run Budgelist locally:

1. **Clone Repository**:
   ```bash
   git clone https://github.com/kuraku01/budgelist.git
   cd budgelist
   ```

2. **Firebase Setup**:
   - Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
   - Enable **Authentication** (Email/Password provider).
   - Enable **Cloud Firestore** and deploy the rules defined in `firestore.rules`.
   - Copy `android/app/src/main/assets/public/firebase-config.example.js` to `firebase-config.js` and populate your Web API credentials.
   - Place your Android `google-services.json` inside `android/app/google-services.json` (see `android/app/google-services.json.example`).

3. **Build Android App**:
   - Open the `android` directory in **Android Studio**.
   - Sync Gradle dependencies and run `./gradlew assembleDebug` or build directly from Android Studio.

---

## User Guide

### 1. Account Setup and Guest Mode

- **Guest Mode**: Select **Continue as Guest** to use the app locally without registering.
- **Account Registration**: Create an account with a unique username and email to synchronize data across multiple devices.
- **Password Reset**: Select **Forgot password?** on the login card to send a password reset verification link to your registered email address (works with email or username input).

### 2. Expense and Recurring Bill Management

- **Log Expense**: Select the add button (`+`) to enter transaction details, amount, category, and optional notes.
- **Recurring Bills**: Define fixed monthly commitments (such as rent or subscriptions) under the **Recurring** tab to automatically apply them to monthly calculations.

### 3. Budget Allocation

- Select **Set Monthly Budget** to define your target spending limit. The dashboard automatically calculates remaining allowance, daily burn rate, and end-of-month projections.

### 4. Currency Conversion

- Select the **Currency Options** button (`⇄`) beside the monthly total to:
  - **Change Symbol**: Update the displayed currency symbol.
  - **Convert Values**: Convert all financial records to a target currency using live exchange rates.

### 5. Data Export

- Navigate to **Settings** and select **Export to CSV** to generate a downloadable spreadsheet of your transaction history.

---

## License

Budgelist is distributed under the MIT License. Developed by Kuraku01.
