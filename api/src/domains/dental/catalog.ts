/**
 * Catálogo de serviços de uma clínica odontológica (demo).
 * Preços de referência para cidades médias do Brasil (não são cotações reais).
 */

export type DentalService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceReais: number;
  keywords: string[];
};

export const DENTAL_SERVICES: DentalService[] = [
  {
    id: "limpeza",
    name: "Limpeza / Profilaxia",
    description: "Remoção de tártaro e placa bacteriana, polimento dental.",
    durationMinutes: 60,
    priceReais: 150,
    keywords: ["limpeza", "profilaxia", "tartar", "tártaro"],
  },
  {
    id: "avaliacao",
    name: "Avaliação / Consulta",
    description: "Consulta inicial com radiografia panorâmica incluída.",
    durationMinutes: 60,
    priceReais: 120,
    keywords: ["avaliacao", "avaliação", "consulta", "radiografia", "exame"],
  },
  {
    id: "retorno",
    name: "Retorno",
    description: "Consulta de retorno para acompanhamento de tratamento.",
    durationMinutes: 30,
    priceReais: 0,
    keywords: ["retorno", "acompanhamento", "seguimento"],
  },
  {
    id: "restauracao",
    name: "Restauração / Obturação",
    description: "Tratamento de cárie com resina composta.",
    durationMinutes: 60,
    priceReais: 250,
    keywords: ["restauracao", "restauração", "obturacao", "obturação", "carie", "cárie", "resina"],
  },
  {
    id: "extracao",
    name: "Extração",
    description: "Extração dentária simples sob anestesia local.",
    durationMinutes: 60,
    priceReais: 200,
    keywords: ["extracao", "extração", "extrair", "arrancar", "remover dente"],
  },
  {
    id: "emergencia",
    name: "Emergência",
    description: "Atendimento de urgência para dor aguda ou trauma dental.",
    durationMinutes: 60,
    priceReais: 180,
    keywords: ["emergencia", "emergência", "urgencia", "urgência", "dor", "trauma"],
  },
  {
    id: "clareamento",
    name: "Clareamento",
    description: "Clareamento dental a laser (sessão única).",
    durationMinutes: 90,
    priceReais: 600,
    keywords: ["clareamento", "clarea", "branquear", "branqueamento"],
  },
  {
    id: "ortodontia",
    name: "Ortodontia / Aparelho",
    description: "Consulta de avaliação para aparelho ortodôntico.",
    durationMinutes: 60,
    priceReais: 150,
    keywords: ["ortodontia", "aparelho", "alinhador", "invisalign", "bracket"],
  },
];

export function serviceById(id: string): DentalService | undefined {
  return DENTAL_SERVICES.find((s) => s.id === id);
}

export function resolveServiceIdFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const svc of DENTAL_SERVICES) {
    if (svc.keywords.some((kw) => lower.includes(kw))) return svc.id;
  }
  return undefined;
}

export function formatServicesText(): string {
  const lines = DENTAL_SERVICES.map((s) => {
    const price = s.priceReais > 0 ? `R$ ${s.priceReais}` : "Incluso no tratamento";
    return `• ${s.name} — ${price} (${s.durationMinutes}min)\n  ${s.description}`;
  });
  return lines.join("\n\n");
}

export function servicesPayloadForApi() {
  return {
    services: DENTAL_SERVICES.map(({ id, name, description, durationMinutes, priceReais }) => ({
      id,
      name,
      description,
      durationMinutes,
      priceReais,
    })),
  };
}
