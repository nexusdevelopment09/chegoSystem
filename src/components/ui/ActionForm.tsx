"use client";

import { createContext, startTransition, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./Button";

export type ActionState = { error?: string; ok?: boolean; message?: string };
type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext<boolean | null>(null);

type Props = {
  action: Action;
  children: ReactNode;
  className?: string;
  /** Called once each time the action succeeds (e.g. to open the print window). */
  onSuccess?: () => void;
  /** Clears the fields after a success (message boxes). */
  resetOnSuccess?: boolean;
};

/**
 * A form bound to a server action that shows the action's message under it.
 *
 * The action is called by hand instead of through the form's `action`
 * attribute, because that would clear every field when the action finishes,
 * and losing what you typed because of a validation error is the worst
 * moment to lose it. Fields are only cleared on success, when asked.
 */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    if (resetOnSuccess) form.current?.reset();
    onSuccess?.();
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <form
      ref={form}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        // The clicked button goes along, so its name and value reach the action.
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext value={pending}>{children}</PendingContext>
      {state.ok && state.message && (
        <p role="status" className="mt-1 w-full text-sm font-bold text-success">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-1 w-full text-sm font-bold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

type SubmitProps = {
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  name?: string;
  value?: string;
};

/** Submit button that disables itself while its form is being sent. */
export function SubmitButton({ children, variant, className, name, value }: SubmitProps) {
  const fromActionForm = use(PendingContext);
  const { pending: fromPlainForm } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} name={name} value={value} disabled={fromActionForm ?? fromPlainForm}>
      {children}
    </Button>
  );
}
