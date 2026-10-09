// Portuguese labels for values stored in English in the database.

export const STORE_ROLE_LABELS = {
  owner: "Dono",
  attendant: "Atendente",
  courier: "Entregador",
} as const;

/** Emoji shown for each category icon key (light, no icon library needed). */
export const CATEGORY_EMOJI: Record<string, string> = {
  utensils: "🍽️",
  burger: "🍔",
  coffee: "☕",
  "ice-cream": "🍧",
  bottle: "🥤",
  basket: "🛒",
  pill: "💊",
  leaf: "🥗",
};
