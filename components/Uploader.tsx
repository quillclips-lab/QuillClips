"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadVideo, type UploadContext } from "@/lib/api";
import { bytes } from "@/lib/format";
import { IconUpload } from "./icons";
import { Button, cx, ErrorBox, Progress, RecDot } from "./ui";

const ACCEPT = ".mp4,.mov,.mkv,.webm,.avi,.m4v,.flv,.wmv,.mpg,.mpeg,.ts,.mts,.m2ts,.3gp,.ogv,.vob,.f4v,.asf,.mxf,video/*";

/** Drop zone. `context` (brief, exclusions, campaign) is attached to the video so analysis can use it. */
export default function Uploader({ context }: { context?: UploadContext }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);

  async function start(f: File) {
    setFile(f);
    setError(null);
    setProgress(0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const t0 = performance.now();
    try {
      const video = await uploadVideo(
        f,
        (p) => {
          setProgress(p);
          const secs = (performance.now() - t0) / 1000;
          if (secs > 0.5) setSpeed((p * f.size) / secs);
        },
        context,
        ctrl.signal,
      );
      router.push(`/uretim/${video.id}`);
    } catch (e) {
      setError((e as Error).message);
      setFile(null);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !file) start(f);
        }}
        className={cx(
          "relative flex min-h-[340px] flex-col items-center justify-center overflow-hidden rounded-[var(--radius-bento)] border border-dashed p-10 text-center transition-all duration-300",
          drag ? "scale-[1.005] border-fg bg-[#101010]" : "border-line-2 bg-card",
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: "radial-gradient(circle at 50% 0%, #1d1d1d 0%, transparent 60%)",
          }}
        />
        {!file ? (
          <div className="relative flex flex-col items-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-line-2 bg-[#111] text-fg">
              <IconUpload size={24} />
            </div>
            <div className="font-display text-[26px] font-semibold leading-tight">Videoyu buraya bırak</div>
            <p className="mt-2 max-w-md text-[14px] text-muted">
              15 dakikadan 2+ saate kadar uzun videolar. MP4, MOV, MKV, WEBM, AVI, M4V ve ffmpeg&apos;in desteklediği tüm formatlar.
            </p>
            <Button variant="primary" className="mt-7" onClick={() => input.current?.click()}>
              Dosya seç
            </Button>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) start(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div className="relative w-full max-w-lg">
            <div className="mb-1 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted">
              <RecDot /> Yükleniyor
            </div>
            <div className="truncate font-display text-[22px] font-semibold">{file.name}</div>
            <div className="mt-6 font-display text-[56px] font-semibold leading-none">{Math.floor(progress * 100)}%</div>
            <div className="mt-5">
              <Progress value={progress} />
            </div>
            <div className="mt-3 flex justify-between font-mono text-[11px] text-muted">
              <span>
                {bytes(progress * file.size)} / {bytes(file.size)}
              </span>
              <span>{speed ? `${bytes(speed)}/sn` : "—"}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-6"
              onClick={() => {
                abort.current?.abort();
                setFile(null);
              }}
            >
              İptal
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
    </div>
  );
}
