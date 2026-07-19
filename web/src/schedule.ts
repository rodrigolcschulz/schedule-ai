/** Deve refletir `api/src/domains/dental/index.ts` (horário de Brasília). */
export const SCHEDULE_HINT =
  "Atendimento: seg–sex 8h–17h no horário de Brasília, slots de 1h (último início às 17h).";


export function formatSlotTimeBr(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatSlotDateBr(isoUtc: string): string {
  return new Date(isoUtc).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

export function formatBookingWhenBr(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
