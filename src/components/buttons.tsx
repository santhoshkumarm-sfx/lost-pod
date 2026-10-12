'use client';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, pending, className, confirm, name, value, disabled, cancel }: {
  children: React.ReactNode; pending?: string; className?: string; confirm?: string; name?: string; value?: string; disabled?: boolean;
  /** Show a Cancel button next to it: true = undo what was typed in this form, a string = go to that page. */
  cancel?: boolean | string;
}) {
  const status = useFormStatus();
  const button = (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled || status.pending}
      className={className ?? 'btn btn-primary'}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {status.pending ? (pending ?? 'Saving…') : children}
    </button>
  );
  if (!cancel) return button;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {button}
      {typeof cancel === 'string' ? (
        <a href={cancel} className="btn btn-ghost">Cancel</a>
      ) : (
        <button type="reset" className="btn btn-ghost" disabled={status.pending}>Cancel</button>
      )}
    </span>
  );
}

/** Checkbox that toggles every row checkbox with the given name inside the same form. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
