"""Platform analytics providers.

Each platform implements the same small interface so real OAuth/analytics can be dropped in later
(YouTube Data/Analytics API, TikTok Display API, Instagram Graph API). For now every provider is
"not connected" and returns clearly-marked placeholder numbers for the dashboard.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field


@dataclass
class PlatformStats:
    platform: str
    label: str
    connected: bool
    placeholder: bool
    total_views: int
    followers: int
    last7: list[int] = field(default_factory=list)
    best_clip: dict | None = None


class PlatformProvider:
    id = ""
    label = ""
    seed = 1

    def is_connected(self) -> bool:
        return False

    def connect_url(self) -> str | None:
        return None

    def clip_views(self, clip_ids: list[str]) -> int | None:
        """Total views of the given clips on this platform; None while not connected."""
        return None

    def stats(self) -> PlatformStats:
        base = 1000 * self.seed
        last7 = [int(base * (1.4 + math.sin(i * 0.9 + self.seed))) for i in range(7)]
        return PlatformStats(self.id, self.label, connected=False, placeholder=True,
                             total_views=sum(last7) * 37, followers=base * 3 + 412, last7=last7,
                             best_clip={"title": "Örnek klip başlığı", "views": max(last7) * 9})


class YouTubeProvider(PlatformProvider):
    id, label, seed = "youtube", "YouTube", 3


class TikTokProvider(PlatformProvider):
    id, label, seed = "tiktok", "TikTok", 5


class InstagramProvider(PlatformProvider):
    id, label, seed = "instagram", "Instagram", 2


PROVIDERS: list[PlatformProvider] = [YouTubeProvider(), TikTokProvider(), InstagramProvider()]


def all_stats() -> list[dict]:
    return [asdict(p.stats()) for p in PROVIDERS]


def campaign_views(campaign_id: str) -> int | None:
    """Real views of a campaign's clips across connected platforms (feeds views x CPM / 1000).

    Returns None until at least one provider is connected — the dashboard then shows a placeholder
    instead of inventing earnings.
    """
    from . import db
    ids = [r["id"] for r in db.query("SELECT id FROM clips WHERE campaign_id=?", [campaign_id])]
    counts = [p.clip_views(ids) for p in PROVIDERS if p.is_connected()]
    counts = [c for c in counts if c is not None]
    return sum(counts) if counts else None
