# Deployment checklist

1. Deploy the Healthcarology API and PostgreSQL service behind HTTPS.
2. Allow capacitor://localhost, https://localhost, and the production web origin in server CORS.
3. Run: pnpm configure:api -- https://api.your-domain.com
4. Run: pnpm install, pnpm assets, pnpm sync, and pnpm verify.
5. Test family isolation, linked students, password reset/change, authenticator verification, uploads, print/share, timeout, and offline recovery.

Android: install Android Studio/SDK and Java, open with pnpm android, configure the protected Play signing key, build an App Bundle, test internally, and complete Play disclosures.

iOS: use a Mac with Xcode, open with pnpm ios, select the Apple team, confirm org.healthcarology.family, archive, test with TestFlight, and complete App Store disclosures.

Do not release until the public API, server authorization, HTTPS, secrets, backups, audit logs, retention/deletion, privacy/support URLs, signing, and device tests are complete.
