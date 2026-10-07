'use client';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, pending, className, confirm, name, value, disabled }: {
  children: React.ReactNode; pending?: string; className?: string; confirm?: string; name?: string; value?: string; disabled?: boolean;
}) {
  const status = useFormStatus();
  return (
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
