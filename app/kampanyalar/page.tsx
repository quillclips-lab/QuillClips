"use client";

import { useState } from "react";
import { IconCampaign, IconDrive, IconLink, IconPlus, IconTrash, PlatformIcon } from "@/components/icons";
import { Button, Card, CheckChip, ErrorBox, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, Toast } from "@/components/ui";
import { api, type Campaign, type CampaignInput, type Platform, type SharePlatform } from "@/lib/api";
import { money, PLATFORM_LABEL } from "@/lib/format";
import { usePoll, useToast } from "@/lib/hooks";

const SHARE: SharePlatform[] = ["youtube", "tiktok", "instagram"];
const PERSON_PLATFORMS: Platform[] = ["kick", "twitch", "youtube", "tiktok", "instagram", "x", "podcast"];

type Draft = {
  id?: string;
  name: string;
  url: string;
  cpm: string;
  platforms: SharePlatform[];
  drive_url: string;
  personPlatform: Platform;
  personUser: string;
  personIg: string;
  notes: string;
};

const EMPTY: Draft = {
  name: "",
  url: "",
  cpm: "",
  platforms: ["youtube", "tiktok", "instagram"],
  drive_url: "",
  personPlatform: "kick",
  personUser: "",
  personIg: "",
  notes: "",
};

function toDraft(c: Campaign): Draft {
  return {
    id: c.id,
    name: c.name,
    url: c.url,
    cpm: String(c.cpm),
    platforms: c.platforms,
    drive_url: c.drive_url || "",
    personPlatform: (c.person?.platform as Platform) || "kick",
    personUser: c.person?.username || "",
    personIg: c.person?.instagram || "",
    notes: c.notes || "",
  };
}

function validate(d: Draft): string | null {
  if (!d.url.trim()) return "Whop Content Rewards linki zorunlu.";
  if (!/^https?:\/\/\S+$/i.test(d.url.trim())) return "Link https:// ile başlamalı.";
  if (!d.name.trim()) return "Kampanya adı zorunlu.";
  const cpm = Number(d.cpm.replace(",", "."));
  if (!d.cpm.trim() || !Number.isFinite(cpm) || cpm <= 0) return "CPM 0'dan büyük bir sayı olmalı (ör. 1.5).";
  if (!d.platforms.length) return "En az bir platform seçin.";
  if (d.drive_url.trim() && !/^https?:\/\/\S+$/i.test(d.drive_url.trim())) return "Drive linki https:// ile başlamalı.";
  return null;
}

export default function KampanyalarPage() {
  const { data, error, refresh } = usePoll<Campaign[]>("/api/campaigns");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast, show } = useToast();

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => draft && setDraft({ ...draft, [k]: v });

  async function save() {
    if (!draft) return;
    const problem = validate(draft);
    setFormError(problem);
    if (problem) return;
    const body: CampaignInput = {
      name: draft.name.trim(),
      url: draft.url.trim(),
      cpm: Number(draft.cpm.replace(",", ".")),
      platforms: draft.platforms,
      drive_url: draft.drive_url.trim() || null,
      notes: draft.notes.trim() || null,
      person: draft.personUser.trim()
        ? { platform: draft.personPlatform, username: draft.personUser.trim().replace(/^@+/, ""), instagram: draft.personIg.trim().replace(/^@+/, "") }
        : null,
    };
    setSaving(true);
    try {
      if (draft.id) await api(`/api/campaigns/${draft.id}`, { method: "PUT", json: body });
      else await api("/api/campaigns", { method: "POST", json: body });
      setDraft(null);
      refresh();
      show(draft.id ? "Kampanya güncellendi" : "Kampanya eklendi");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Campaign) {
    if (!confirm(`"${c.name}" silinsin mi? Klipler silinmez, sadece kampanya bağlantısı kalkar.`)) return;
    try {
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      refresh();
      show("Kampanya silindi");
    } catch (e) {
      show((e as Error).message, "err");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="QuillClips / Kampanyalar"
        title="Kampanyalar"
        right={
          <Button
            variant="primary"
            onClick={() => {
              setFormError(null);
              setDraft({ ...EMPTY, platforms: [...EMPTY.platforms] });
            }}
          >
            <IconPlus size={16} /> Kampanya ekle
          </Button>
        }
      />
      {error && <ErrorBox message={error} onRetry={refresh} />}

      {!data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-[var(--radius-bento)] border border-line bg-card px-6 py-16 text-center animate-fade-up">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line-2 bg-[#111] text-muted">
            <IconCampaign size={22} />
          </div>
          <div className="font-display text-[20px] font-semibold">Henüz kampanya yok</div>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
            Whop Content Rewards kampanyalarını ekle. Üretimde kampanya seçtiğinde alt bar, geçerli platformların açıklamaları ve kampanya kuralları otomatik uygulanır.
          </p>
          <Button className="mt-6" variant="outline" onClick={() => setDraft({ ...EMPTY, platforms: [...EMPTY.platforms] })}>
            <IconPlus size={15} /> İlk kampanyayı ekle
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c, i) => (
            <Card key={c.id} delay={i * 40} className="group flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-[19px] font-semibold leading-tight">{c.name}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {c.platforms.map((p) => (
                      <span key={p} title={PLATFORM_LABEL[p]} className="flex h-6 w-6 items-center justify-center rounded-lg border border-line-2 bg-[#111]">
                        <PlatformIcon platform={p} size={13} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-[26px] font-semibold leading-none">{money(c.cpm)}</div>
                  <div className="mt-1 font-mono text-[10.5px] uppercase tracking-wider text-dim">CPM · 1K izlenme</div>
                </div>
              </div>

              {c.person?.username && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-[#0b0b0b] px-3 py-2 text-[12.5px]">
                  <PlatformIcon platform={c.person.platform || "kick"} size={14} />
                  <span className="text-fg">@{c.person.username}</span>
                  {c.person.instagram && (
                    <span className="ml-auto flex items-center gap-1 text-muted">
                      <PlatformIcon platform="instagram" size={12} /> @{c.person.instagram}
                    </span>
                  )}
                </div>
              )}
              {c.notes && <p className="mt-3 line-clamp-3 text-[12.5px] leading-relaxed text-muted">{c.notes}</p>}

              <div className="mt-auto pt-4">
                <div className="mb-3 flex items-center gap-4 font-mono text-[11px] text-dim">
                  <span>
                    <span className="text-fg">{c.clip_count}</span> klip
                  </span>
                  <span>
                    <span className="text-fg">{c.clips_done}</span> hazır
                  </span>
                  <span>
                    <span className="text-fg">{c.video_count}</span> video
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-card-2 px-3 text-[12.5px] text-fg transition-colors hover:border-[#3a3a3a]">
                    <IconLink size={13} /> Kampanya
                  </a>
                  {c.drive_url && (
                    <a href={c.drive_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-card-2 px-3 text-[12.5px] text-fg transition-colors hover:border-[#3a3a3a]">
                      <IconDrive size={13} /> Drive
                    </a>
                  )}
                  <div className="ml-auto flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setFormError(null);
                        setDraft(toDraft(c));
                      }}
                    >
                      Düzenle
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => remove(c)} aria-label="Sil">
                      <IconTrash size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Kampanyayı düzenle" : "Kampanya ekle"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Vazgeç
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Kaydet
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Whop Content Rewards linki" required>
              <Input value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://whop.com/..." autoFocus />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_1fr]">
              <Field label="Kampanya adı" required>
                <Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="ör. Marco Reyes Trading" />
              </Field>
              <Field label="CPM" hint="$ / 1.000 izlenme" required>
                <Input prefix="$" inputMode="decimal" value={draft.cpm} onChange={(e) => set("cpm", e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="1.50" />
              </Field>
            </div>
            <Field label="Geçerli platformlar" hint="en az bir tane" required>
              <div className="flex flex-wrap gap-2">
                {SHARE.map((p) => (
                  <CheckChip
                    key={p}
                    checked={draft.platforms.includes(p)}
                    onChange={(on) => set("platforms", on ? [...draft.platforms, p] : draft.platforms.filter((x) => x !== p))}
                  >
                    <PlatformIcon platform={p} size={14} /> {PLATFORM_LABEL[p]}
                  </CheckChip>
                ))}
              </div>
            </Field>
            <Field label="Google Drive kaynak linki" hint="opsiyonel">
              <Input value={draft.drive_url} onChange={(e) => set("drive_url", e.target.value)} placeholder="https://drive.google.com/..." />
            </Field>
            <Field label="Klipteki kişi" hint="opsiyonel · alt barı doldurur">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[0.9fr_1.2fr_1.2fr]">
                <Select value={draft.personPlatform} onChange={(v) => set("personPlatform", v)} options={PERSON_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))} />
                <Input prefix="@" value={draft.personUser} onChange={(e) => set("personUser", e.target.value.replace(/^@+/, ""))} placeholder="kullanıcı adı" />
                <Input prefix="@" value={draft.personIg} onChange={(e) => set("personIg", e.target.value.replace(/^@+/, ""))} placeholder="Instagram (ops.)" />
              </div>
            </Field>
            <Field label="Notlar / kurallar" hint="Claude'a bağlam olarak gider">
              <Textarea
                rows={4}
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder={"ör. Her açıklamada #ad ve @marcoreyes olmalı. Küfürlü anlar kullanılmayacak. Sadece trading içeriği."}
              />
            </Field>
            {formError && <ErrorBox message={formError} />}
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </>
  );
}
