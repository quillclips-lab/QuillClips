"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconCheck, IconCopy } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  label,
  right,
  delay = 0,
}: {
  children?: ReactNode;
  className?: string;
  label?: ReactNode;
  right?: ReactNode;
  delay?: number;
}) {
  return (
    <section
      className={cx(
        "rounded-[var(--radius-bento)] border border-line bg-card p-5 animate-fade-up transition-colors",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {(label || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {label ? <span className="label">{label}</span> : <span />}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "rec" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "outline", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "relative inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-all duration-200",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-fg text-ink hover:bg-white",
        variant === "outline" && "border border-line-2 bg-card-2 text-fg hover:border-[#3a3a3a] hover:bg-[#161616]",
        variant === "ghost" && "text-muted hover:bg-[#141414] hover:text-fg",
        variant === "rec" && "bg-rec text-white hover:brightness-110",
        variant === "danger" && "text-muted hover:bg-rec/10 hover:text-rec",
        className,
      )}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex cursor-pointer items-start justify-between gap-4 py-1", disabled && "cursor-default")}>
      <span className="min-w-0">
        <span className="block text-[14px] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cx(
          "relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200",
          checked ? "border-fg bg-fg" : "border-line-2 bg-[#141414]",
          disabled && "opacity-60",
        )}
      >
        <span
          className={cx(
            "absolute top-[2px] h-4 w-4 rounded-full transition-all duration-200",
            checked ? "left-[18px] bg-ink" : "left-[2px] bg-[#555]",
          )}
        />
      </button>
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 w-full appearance-none rounded-xl border border-line-2 bg-[#0f0f0f] pl-3 pr-9 text-sm text-fg outline-none transition-colors hover:border-[#333] focus:border-[#444]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#111]">
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" width="12" height="12" viewBox="0 0 12 12">
        <path d="M3 4.5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { prefix?: string }) {
  const { prefix, className, ...rest } = props;
  return (
    <div
      className={cx(
        "flex h-10 items-center rounded-xl border border-line-2 bg-[#0f0f0f] px-3 transition-colors focus-within:border-[#444] hover:border-[#333]",
        className,
      )}
    >
      {prefix && <span className="mr-1 font-mono text-sm text-muted">{prefix}</span>}
      <input {...rest} className="h-full w-full bg-transparent text-sm text-fg outline-none placeholder:text-dim" />
    </div>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cx(
        "w-full resize-none rounded-xl border border-line-2 bg-[#0f0f0f] px-3 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-dim hover:border-[#333] focus:border-[#444]",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, required }: { label: ReactNode; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-fg">
          {label}
          {required && <span className="ml-1 text-rec">*</span>}
        </span>
        {hint && <span className="text-[11px] text-dim">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[640px] animate-fade-up rounded-[var(--radius-bento)] border border-line-2 bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-[20px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted transition-colors hover:bg-[#161616] hover:text-fg" aria-label="Kapat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function CheckChip({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cx(
        "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] transition-all",
        checked ? "border-fg bg-[#161616] text-fg" : "border-line-2 bg-[#0f0f0f] text-muted hover:border-[#333] hover:text-fg",
      )}
    >
      <span className={cx("flex h-4 w-4 items-center justify-center rounded-[5px] border", checked ? "border-fg bg-fg text-ink" : "border-[#444]")}>
        {checked && <IconCheck size={11} />}
      </span>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-xl border border-line-2 bg-[#0f0f0f] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 flex-1 rounded-lg px-2 text-[12.5px] transition-all duration-200",
            value === o.value ? "bg-fg text-ink" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function Progress({ value, tone = "fg" }: { value: number; tone?: "fg" | "rec" }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#1c1c1c]">
      <div
        className={cx("h-full rounded-full transition-[width] duration-500 ease-out", tone === "rec" ? "bg-rec" : "bg-fg")}
        style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function CopyButton({ text, label = "Kopyala" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={cx(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-all",
        done ? "border-fg bg-fg text-ink" : "border-line-2 text-muted hover:border-[#3a3a3a] hover:text-fg",
      )}
    >
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {done ? "Kopyalandı" : label}
    </button>
  );
}

export function RecDot({ className }: { className?: string }) {
  return <span className={cx("inline-block h-1.5 w-1.5 rounded-full bg-rec animate-rec", className)} />;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "rec" | "solid" }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 font-mono text-[10.5px] uppercase tracking-wider",
        tone === "default" && "border-line-2 text-muted",
        tone === "rec" && "border-rec/40 text-rec",
        tone === "solid" && "border-fg bg-fg text-ink",
      )}
    >
      {children}
    </span>
  );
}

export function Toast({ toast }: { toast: { msg: string; tone: "ok" | "err" } | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-up">
      <div
        className={cx(
          "rounded-full border px-5 py-2.5 text-sm shadow-2xl backdrop-blur",
          toast.tone === "err" ? "border-rec/40 bg-[#1a0b0c]/90 text-[#ffb4b6]" : "border-line-2 bg-[#111]/90 text-fg",
        )}
      >
        {toast.msg}
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, right }: { eyebrow: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        <div className="label mb-2">{eyebrow}</div>
        <h1 className="font-display text-[34px] font-semibold leading-none md:text-[42px]">{title}</h1>
      </div>
      {right}
    </div>
  );
}

export function ErrorBox({ message, onRetry, retryLabel = "Tekrar dene" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rec/30 bg-rec/[0.06] px-4 py-3">
      <div className="flex items-start gap-2.5 text-[13.5px] text-[#ffc7c9]">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rec" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
