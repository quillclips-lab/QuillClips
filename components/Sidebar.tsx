"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { IconCampaign, IconInventory, IconPanel, IconProduce, IconSettings } from "./icons";
import { cx, RecDot } from "./ui";

const NAV = [
  { href: "/", label: "Panel", icon: IconPanel },
  { href: "/uretim", label: "Üretim", icon: IconProduce },
  { href: "/envanter", label: "Envanter", icon: IconInventory },
  { href: "/kampanyalar", label: "Kampanyalar", icon: IconCampaign },
  { href: "/ayarlar", label: "Ayarlar", icon: IconSettings },
];

export default function Sidebar() {
  const path = usePathname();
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const jobs = await api<{ status: string }[]>("/api/jobs?active=1");
        if (!alive) return;
        setOnline(true);
        setBusy(jobs.filter((j) => j.status === "running" || j.status === "queued").length);
      } catch {
        if (alive) setOnline(false);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <aside className="sticky top-0 z-20 flex h-auto w-full shrink-0 flex-row items-center gap-2 border-b border-line bg-ink/90 px-4 py-3 backdrop-blur md:h-screen md:w-[232px] md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-4 md:py-6">
      <Link href="/" className="mb-0 flex items-center px-2 md:mb-10">
        <Image src="/logo.png" alt="QuillClips" width={1202} height={209} priority className="h-[22px] w-auto" />
      </Link>
      <nav className="flex flex-1 flex-row gap-1 overflow-x-auto md:flex-col">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-all duration-200",
                active ? "bg-[#121212] text-fg" : "text-muted hover:bg-[#0e0e0e] hover:text-fg",
              )}
            >
              {active && <span className="absolute left-0 top-1/2 hidden h-4 w-[2px] -translate-y-1/2 rounded-full bg-fg md:block" />}
              <Icon size={17} className="shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden rounded-2xl border border-line bg-card p-3.5 md:block">
        <div className="label mb-2 flex items-center gap-2">
          {online ? busy ? <RecDot /> : <span className="h-1.5 w-1.5 rounded-full bg-[#3ddc84]" /> : <span className="h-1.5 w-1.5 rounded-full bg-dim" />}
          Worker
        </div>
        <div className="text-[12.5px] text-muted">
          {online === null ? "Bağlanıyor…" : online ? (busy ? `${busy} iş işleniyor` : "Hazır, kuyruk boş") : "Çevrimdışı"}
        </div>
      </div>
    </aside>
  );
}
