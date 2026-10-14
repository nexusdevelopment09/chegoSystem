import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { resetPassword } from "./actions";

/** "Gerar senha nova": para quem esqueceu a senha e pediu ao suporte. */
export function ResetPasswordForm({ profileId, className = "" }: { profileId: string; className?: string }) {
  return (
    <ActionForm action={resetPassword} className={`flex flex-col gap-2 ${className}`}>
      <input type="hidden" name="profileId" value={profileId} />
      <SubmitButton variant="secondary" className="min-h-11 self-start px-4 text-sm">Gerar senha nova</SubmitButton>
    </ActionForm>
  );
}
