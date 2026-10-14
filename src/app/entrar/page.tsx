import type { Metadata } from "next";
import { LoginChooser } from "./LoginChooser";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return <LoginChooser />;
}
