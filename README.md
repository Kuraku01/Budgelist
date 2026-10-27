# Budgelist

![Version](https://img.shields.io/badge/version-0.1.3--beta-purple.svg)
![Platform](https://img.shields.io/badge/platform-Android-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Offline Support](https://img.shields.io/badge/offline-100%25%20supported-brightgreen.svg)

**Budgelist** is a privacy-focused personal expense tracker, monthly budgeting application, and financial forecasting tool. It combines local-first offline performance with real-time cloud synchronization across devices.

The application allows users to log daily expenses, track recurring bills, convert between global currencies using live exchange rates, and view trend-line forecasts predicting end-of-month budget adherence.

---

## What's New in v0.1.3-beta

- **Upgraded Forecast Engine**: Multi-factor forecasting algorithm incorporating upcoming unpaid recurring bills on scheduled days and multi-month spend velocity baselines.
- **Safe Daily Spend Target**: Real-time daily variable spend allowance to keep your budget on track.
- **Multi-Tier Budget Warnings**: Intelligent alerts for critical over-budget spending (red), near-budget caution (amber), and on-track status (green).
- **Budget Reference Line**: Visual dashed reference line on the forecast chart corresponding to your monthly budget limit.

---

## Key Capabilities

### Local-First Architecture & Offline Performance

- **Zero-Delay Startup**: Launches instantly from local storage without blocking on network requests or server availability.
- **Offline Data Persistence**: Add, edit, or delete expenses and recurring bills offline. All mutations persist locally and automatically synchronize when a network connection is established.
- **Guest Access**: Full application functionality is available offline without requiring account registration.
- **Automatic Schema Migrations**: Safe, versioned schema migrations maintain local database integrity when data formats change across application versions.

### Over-The-Air (OTA) Live Updates & Update Management

- **Zero-Friction Web OTA Updates**: Background web bundle updater automatically downloads and applies `dist.zip` assets attached to GitHub Releases.
- **Loading Screen Progress Indicator**: Displays real-time download percentage and extraction progress bar when a new web update is detected on boot.
- **Mandatory vs. Optional Update Controls**: Differentiates breaking version changes from optional minor patches to ensure API compatibility without unnecessary user friction.

### Multi-Currency Management & Live Exchange Rates

- **Global Currency Support**: Native support for major global currencies including USD ($), EUR (€), GBP (£), JPY (¥), PHP (₱), AUD (A$), CAD (C$), INR (₹), BRL (R$), and CHF (Fr).
- **Automated Rate Conversion**: Fetches live exchange rates and converts all existing expenses, recurring bills, and budget targets to any selected target currency.
- **Atomic Database Sync**: Currency conversions are committed to the database using atomic batch operations to ensure data integrity across devices.

### Financial Forecasting & Analytics

- **Visual Category Distribution**: Provides inline vector charts (Donut and Bar views) for spending category breakdowns.
- **Linear Regression Forecast**: Calculates a least-squares trendline across daily cumulative spending to project end-of-month totals against budget limits.

### Privacy, Security & Code Quality

- **Isolated User Storage**: Data access is restricted to authenticated account owners via server-enforced security policies.
- **Content Security Policy (CSP)**: Enforces strict resource origin controls for Firebase Auth, Google APIs, WebSocket streams, and GitHub Releases API.
- **XSS & Credential Protection**: Completely eliminates `innerHTML` sinks in dynamic list rendering and prevents raw password persistence in local storage.

### Native Android Features

- **CSV Data Export**: Export monthly expense records directly to the device's Downloads directory in standard CSV format.
- **System Theme Integration**: Supports Light and Dark modes matching system appearance preferences.

---

## Installation & Setup

### Installing the Android Application

1. Navigate to the [Releases](https://github.com/Kuraku01/Budgelist/releases) page of this repository.
2. Download the latest `Budgelist_0.1.3-beta.apk` asset.
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
