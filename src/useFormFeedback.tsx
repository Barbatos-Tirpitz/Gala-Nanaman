import { useId, useState } from 'react';
import type { z } from 'zod';

export function useFormFeedback() {
  const prefix = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  function validate(form: HTMLFormElement, result: { success: boolean; error?: z.ZodError }): boolean {
    const next: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) {
        const name = String(issue.path[0] ?? 'title');
        next[name] ??= issue.message;
      }
    }
    setErrors(next);
    const first = form.elements.namedItem(Object.keys(next)[0]);
    if (first instanceof HTMLElement) first.focus();
    return result.success;
  }
  const field = (name: string) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${prefix}-${name}` : undefined,
    onInput: () => setErrors((current) => ({ ...current, [name]: '' })),
  });
  const error = (name: string) => errors[name] ? <span id={`${prefix}-${name}`} className="form-error">{errors[name]}</span> : null;
  return { validate, field, error };
}