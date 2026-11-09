import { Check, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { BottomNav } from './BottomNav';

export function Screen({
  cover,
  children,
  nav = true,
}: {
  cover: ReactNode;
  children: ReactNode;
  nav?: boolean;
}) {
  return (
    <div className="screen">
      <header className="cover">{cover}</header>
      <main className={`page${nav ? ' page-with-nav' : ''}`}>{children}</main>
      {nav && <BottomNav />}
    </div>
  );
}

export function CoverTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="cover-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean }) {
  return (
    <button type="button" {...props} className={`btn btn-${variant} ${props.className ?? ''}`} disabled={props.disabled || busy}>
      {busy ? <LoaderCircle size={18} className="spin" aria-label="Подождите" /> : children}
    </button>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-body">
        <div className="stat-label">
          {icon}
          <span>{label}</span>
        </div>
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Ornament() {
  return (
    <div className="ornament" aria-hidden="true">
      <svg viewBox="-10 -10 20 20" width="14" height="14">
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="-6" y="-6" width="12" height="12" />
          <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" />
        </g>
      </svg>
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn ink" aria-label="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  title,
  text,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="sheet-text">{text}</p>
      <div className="stack">
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}

export function Loading() {
  return (
    <div className="state" role="status">
      <LoaderCircle size={26} className="spin" />
      <span>Загружаю</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?(): void }) {
  return (
    <div className="state" role="alert">
      <TriangleAlert size={26} />
      <span>{error.message}</span>
      {onRetry && (
        <Button variant="quiet" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {text && <span>{text}</span>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true">{checked && <Check size={13} />}</i>
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toast() {
  const { toastMessage } = useApp();
  if (!toastMessage) return null;
  return (
    <div className="toast" role="status">
      {toastMessage}
    </div>
  );
}

const SEAL_LABEL: Record<string, string> = {
  met: 'норма выполнена',
  partial: 'читает, норма ещё не выполнена',
  missed: 'день без отметки',
  none: 'отчёта пока нет',
  not_joined: 'ещё не подключился',
};

export function Seal({ name, status }: { name: string; status: string }) {
  return (
    <span className={`seal seal-${status}`} title={`${name}: ${SEAL_LABEL[status] ?? ''}`}>
      {name.slice(0, 1)}
    </span>
  );
}
