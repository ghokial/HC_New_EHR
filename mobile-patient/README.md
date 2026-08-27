# Healthcarology Patient Mobile

Dedicated Android and iOS patient portal package derived from the approved HC Students Health Capacitor 8 structure.

## Included

- Android and iOS native projects
- Healthcarology Patient portal web bundle
- TOTP MFA enrollment and verification
- Patient appointments, medication adherence/refills, messaging, community, support, and sharing UI
- Capacitor Share, Filesystem, Network, Preferences, Browser, Camera, and native bridge dependencies inherited from the source mobile package

## Build

1. Configure the deployed Supabase URL and publishable key in `www/supabase-config.js`.
2. Install the pinned packages with `pnpm install --frozen-lockfile`.
3. Run `pnpm sync`.
4. Open Android Studio with `pnpm android`, or open Xcode on macOS with `pnpm ios`.

Signed production releases require the owner-controlled Android release keystore and Apple Developer signing configuration. Do not commit signing keys or service-role credentials.
