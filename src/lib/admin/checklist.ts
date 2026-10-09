/** What the admin confirms before a store goes live. */
export const APPROVAL_CHECKLIST = [
  ["data", "Dados da loja conferidos"],
  ["documents", "Documento (CPF ou CNPJ) conferido"],
  ["menu", "Cardápio com pelo menos 5 produtos com foto"],
  ["hours", "Horários cadastrados"],
  ["areas", "Área de entrega cadastrada (ou só retirada)"],
  ["recipient", "Recebedor configurado no gateway"],
] as const;
