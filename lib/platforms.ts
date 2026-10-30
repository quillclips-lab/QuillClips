import { api, type PlatformStats, type SharePlatform } from "./api";

/**
 * Dashboard analytics providers. Each platform gets its own provider so real account linking
 * (OAuth) and analytics can be added per platform without touching the dashboard UI.
 * Today every provider reads placeholder stats from the worker (`/api/platforms`).
 */
export interface PlatformProvider {
  id: SharePlatform;
  label: string;
  /** Start the account-linking flow. Not implemented yet. */
  connect(): Promise<void>;
  fetchStats(all?: PlatformStats[]): Promise<PlatformStats>;
}

function placeholderProvider(id: SharePlatform, label: string): PlatformProvider {
  return {
    id,
    label,
    async connect() {
      throw new Error(`${label} bağlantısı henüz desteklenmiyor`);
    },
    async fetchStats(all) {
      const list = all ?? (await api<PlatformStats[]>("/api/platforms"));
      const found = list.find((p) => p.platform === id);
      if (!found) throw new Error(`${label} verisi yok`);
      return found;
    },
  };
}

export const youtubeProvider = placeholderProvider("youtube", "YouTube");
export const tiktokProvider = placeholderProvider("tiktok", "TikTok");
export const instagramProvider = placeholderProvider("instagram", "Instagram");

export const PROVIDERS: PlatformProvider[] = [youtubeProvider, tiktokProvider, instagramProvider];
