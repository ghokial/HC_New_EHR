# Healthcarology Family Mobile

Native Android and iOS containers for the Healthcarology Family and Student portals. The application uses the same `family` portal accounts, passwords, required password changes, and authenticator verification as the web platform.

## Before a production build

1. Deploy the FastAPI/PostgreSQL platform behind HTTPS.
2. Run `pnpm configure:api -- https://api.your-domain.com`.
3. Configure the server's allowed mobile origins and production authentication controls.
4. Run `pnpm sync`.
5. Build/sign Android in Android Studio and iOS in Xcode.

The Android App Bundle requires a Play signing key. The iOS archive requires a Mac, Xcode, an Apple Developer team, signing certificates, provisioning, privacy declarations, and final App Store metadata.
