import type { ConfigContext, ExpoConfig } from 'expo/config';

const runtimeEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

const appConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Masjid E Shameem – Chanda Manager',
  slug: config.slug ?? 'masjid-chanda-manager',
  version: config.version ?? '1.0.0',
  plugins: [...(config.plugins ?? []), 'expo-sharing'],
  extra: {
    ...config.extra,
    apiUrl: runtimeEnvironment?.EXPO_PUBLIC_API_URL || 'https://masjid-shameem-staging.kingshoaib.workers.dev',
  },
});

export default appConfig;
