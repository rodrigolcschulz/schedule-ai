import json
from copy import deepcopy
from typing import Optional
import re
from datetime import date, datetime
from contracts.planner import (
    PlannerRequest, PlannerResponse, MissingField, PlanStep,
    ExecuteRequest, ExecuteResponse,
    ReflectRequest, ReflectResponse
)
from rules.rules_engine import RuleEngine
from memory.memory_store import MemoryStore
from guardrails.guardrails import Guardrails
from providers.adapter import ProviderAdapter

INTENT_STEPS = {
    "book": [
        PlanStep(id="slots.list", title="Consultar horários disponíveis", toolName="list_available_slots", toolArgs={}),
        PlanStep(id="booking.create", title="Criar agendamento", toolName="create_booking", toolArgs={}),
    ],
    "cancel": [
        PlanStep(id="booking.find", title="Localizar agendamento", toolName="find_booking", toolArgs={}),
        PlanStep(id="booking.delete", title="Cancelar agendamento", toolName="delete_booking", toolArgs={}),
    ],
    "query": [
        PlanStep(id="appointments.list", title="Listar consultas do paciente", toolName="list_appointments", toolArgs={}),
    ],
    "services": [
        PlanStep(id="services.list", title="Listar serviços da clínica", toolName="get_services", toolArgs={}),
    ],
    "faq": [],
}

REQUIRED_FIELDS = {
    "book":   ["name", "phone", "service", "date"],
    "cancel": ["phone"],
    "query":  ["phone"],
    "services": [],
    "faq":    [],
}

class LLMPlanner:
    def __init__(self):
        self.rule_engine = RuleEngine()
        self.memory_store = MemoryStore()
        self.guardrails = Guardrails()
        self.llm = ProviderAdapter()

    def create_plan(self, request: PlannerRequest) -> PlannerResponse:
        # 1. Recupera memória da sessão
        memory = self.memory_store.get(request.sessionId) if request.sessionId else {}

        # Saudação inicial: evita respostas estranhas e mantém tom acolhedor.
        if self._is_greeting(request.message) and not self._has_active_booking_context(memory):
            return PlannerResponse(
                domainId=request.domainId,
                summary="Saudação inicial.",
                intent="faq",
                confidence=0.99,
                needsClarification=True,
                missingFields=[],
                steps=[],
                suggestedReply="Olá! Que bom falar com você. Posso te ajudar a agendar uma consulta. Se quiser, me diga seu nome para começarmos.",
            )

        # 2. LLM extrai intenção + dados do paciente
        extracted = self._extract(request.message, memory, request.history or [])
        intent = self._normalize_intent(extracted.get("intent", "unknown"), request.message, request.history or [])
        confidence = extracted.get("confidence", 0.5)
        patient = extracted.get("patient", {})

        # "consulta" em contexto de agendar deve virar serviço padrão de avaliação.
        if intent == "book" and not patient.get("service") and self._looks_like_consultation_booking(request.message):
            patient["service"] = "avaliacao"

        # 3. Merge com memória existente (não sobrescreve com null)
        merged = {**memory, **{k: v for k, v in patient.items() if v}}
        merged = self._normalize_patient_fields(merged, request.message)
        if request.sessionId:
            self.memory_store.set(request.sessionId, merged)

        # 4. Descobre campos faltando
        required = REQUIRED_FIELDS.get(intent, [])
        missing = [
            MissingField(**self._missing_field_info(f))
            for f in required if not merged.get(f)
        ]

        # 5. Monta steps com args preenchidos
        steps = self._build_steps(intent, merged)

        # 6. Valida regras de negócio
        needs_clarification = len(missing) > 0
        suggested_reply = self._ask_next(missing) if missing else self._confirm_summary(intent, merged)

        plan = PlannerResponse(
            domainId=request.domainId,
            summary=f"Plano para intenção '{intent}'.",
            intent=intent,
            confidence=confidence,
            needsClarification=needs_clarification,
            missingFields=missing,
            steps=steps,
            suggestedReply=suggested_reply,
        )

        # 7. Valida regras
        rule_result = self.rule_engine.check(plan)
        if not rule_result.valid:
            plan.needsClarification = True
            if not missing:
                plan.suggestedReply = self._friendly_rule_error(rule_result.errors[0])

        return plan

    def execute_plan(self, request: ExecuteRequest) -> ExecuteResponse:
        # O Fastify executa as tools — aqui só validamos guardrails antes
        check = self.guardrails.validate_plan(request.plan)
        if not check["ok"]:
            return ExecuteResponse(success=False, error=check["reason"])
        # Retorna ok; a execução real das tools é feita no Fastify
        return ExecuteResponse(success=True, result={"steps": len(request.plan.steps)})

    def reflect_on_result(self, request: ReflectRequest) -> ReflectResponse:
        if request.plan.intent == "services":
            services_reply = self._build_services_reply(request.executeResult.result)
            approved = self.guardrails.validate_reply(services_reply)
            return ReflectResponse(
                approved=approved,
                finalReply=services_reply if approved else "Desculpe, não consegui listar os serviços agora.",
                insights=[{"intent": "services", "success": request.executeResult.success}],
            )

        if request.plan.intent == "book":
            slots_reply = self._build_slots_reply(request.executeResult.result)
            if slots_reply:
                approved = self.guardrails.validate_reply(slots_reply)
                return ReflectResponse(
                    approved=approved,
                    finalReply=slots_reply if approved else "Desculpe, não consegui listar os horários agora.",
                    insights=[{"intent": "book", "success": request.executeResult.success}],
                )

        # LLM gera a resposta final em linguagem natural
        session_memory = self.memory_store.get(request.sessionId) if request.sessionId else {}
        context = {
            "intent": request.plan.intent,
            "patient": session_memory,
            "result": request.executeResult.result,
        }
        final_reply = self._generate_reply(context)
        approved = self.guardrails.validate_reply(final_reply)

        if request.sessionId and self._should_reset_session_context(request.plan.intent, request.executeResult.result):
            self.memory_store.clear(request.sessionId)

        return ReflectResponse(
            approved=approved,
            finalReply=final_reply if approved else "Desculpe, não consegui processar sua solicitação. Pode repetir?",
            insights=[{"intent": request.plan.intent, "success": request.executeResult.success}],
        )

    # --- helpers privados ---

    def _extract(self, message: str, memory: dict, history: list[dict]) -> dict:
        recent_history = history[-6:] if history else []
        prompt = f"""
Analise a mensagem de um paciente de clínica odontológica.
Dados já conhecidos: {json.dumps(memory, ensure_ascii=False)}
Histórico recente (ordem cronológica): {json.dumps(recent_history, ensure_ascii=False)}

Mensagem: "{message}"

Regras de interpretação:
- Se a mensagem atual for uma confirmação curta (ex.: "sim", "pode", "ok", "isso")
    e no histórico recente a assistente tiver oferecido agendar/continuar agendamento,
    classifique como intent="book".
- Se o paciente disser "quero fazer consulta", "quero marcar consulta", "quero agendar"
    ou frases equivalentes de primeira abordagem, classifique como intent="book".
- Reaproveite dados já conhecidos em memória para evitar perguntas repetidas.

Responda APENAS com JSON válido:
{{
  "intent": "book|cancel|query|faq|unknown",
  "confidence": 0.0,
  "patient": {{
    "name": null,
    "phone": null,
    "service": "limpeza|avaliacao|retorno|restauracao|extracao|emergencia|clareamento|ortodontia|null",
        "date": null,
        "time": null,
        "slot_id": null
  }}
}}
"""
        raw = self.llm.complete(prompt)
        try:
            return json.loads(raw)
        except Exception:
            return {"intent": "unknown", "confidence": 0.3, "patient": {}}

    def _normalize_intent(self, extracted_intent: str, message: str, history: list[dict]) -> str:
        text = (message or "").strip().lower()

        if self._looks_like_services_question(text):
            return "services"

        # Primeira abordagem com desejo de marcar consulta => agendamento.
        if self._looks_like_consultation_booking(text):
            return "book"

        # Confirmação curta após convite para agendar.
        if self._is_short_confirmation(text) and self._recent_assistant_invited_booking(history):
            return "book"

        return extracted_intent if extracted_intent in REQUIRED_FIELDS else "unknown"

    def _looks_like_consultation_booking(self, message: str) -> bool:
        text = (message or "").strip().lower()
        patterns = [
            r"\bquero\s+(fazer|marcar|agendar)\s+(uma\s+)?consulta\b",
            r"\bpreciso\s+de\s+(uma\s+)?consulta\b",
            r"\bgostaria\s+de\s+(fazer|marcar|agendar)\s+(uma\s+)?consulta\b",
            r"\bquero\s+agendar\b",
            r"\bquero\s+marcar\b",
        ]
        return any(re.search(pattern, text) for pattern in patterns)

    def _looks_like_services_question(self, message: str) -> bool:
        text = (message or "").strip().lower()
        return any(
            term in text
            for term in (
                "servico",
                "servicos",
                "serviço",
                "serviços",
                "procedimento",
                "procedimentos",
                "preco",
                "preços",
                "preco",
                "valor",
                "valores",
                "quanto custa",
                "catalogo",
                "catálogo",
            )
        )

    def _is_short_confirmation(self, text: str) -> bool:
        return text in {"sim", "ok", "pode", "isso", "confirmo", "fechado", "certo"}

    def _recent_assistant_invited_booking(self, history: list[dict]) -> bool:
        if not history:
            return False
        recent = history[-4:]
        for entry in reversed(recent):
            role = str(entry.get("role", "")).lower()
            content = str(entry.get("content", "")).lower()
            if role != "assistant":
                continue
            if any(term in content for term in ("agendar", "marcar horário", "marcar um horário", "consulta")):
                return True
            # Para de procurar ao achar uma resposta neutra da assistente.
            if content.strip():
                return False
        return False

    def _missing_field_info(self, field: str) -> dict:
        info = {
            "name": {
                "field": "name",
                "reason": "Nome do paciente não informado.",
                "question": "Perfeito! Para eu continuar, qual é o seu nome completo?",
            },
            "phone": {
                "field": "phone",
                "reason": "Telefone não informado.",
                "question": "Ótimo! Pode me informar seu telefone com DDD, por favor?",
            },
            "service": {
                "field": "service",
                "reason": "Serviço não identificado.",
                "question": "Certo! Qual serviço você deseja? (limpeza, avaliação, extração, etc.)",
            },
            "date": {
                "field": "date",
                "reason": "Data não informada.",
                "question": "Perfeito! Qual data você prefere para a consulta? (DD/MM/AAAA)",
            },
        }
        return info.get(field, {"field": field, "reason": f"{field} não informado.", "question": f"Qual o {field}?"})

    def _build_steps(self, intent: str, merged: dict) -> list[PlanStep]:
        steps = deepcopy(INTENT_STEPS.get(intent, []))

        # Fluxo de booking em duas fases:
        # 1) sem horário escolhido: listar horários da data;
        # 2) com horário escolhido: criar agendamento.
        if intent == "book":
            has_base = all(merged.get(k) for k in ("name", "phone", "service", "date"))
            has_time_choice = bool(merged.get("slot_id") or merged.get("time"))

            filtered_steps: list[PlanStep] = []
            if merged.get("date") and not has_time_choice:
                filtered_steps.append(
                    PlanStep(
                        id="slots.list",
                        title="Consultar horários disponíveis",
                        toolName="list_available_slots",
                        toolArgs={"date": merged.get("date")},
                    )
                )

            if has_base and has_time_choice:
                filtered_steps.append(
                    PlanStep(
                        id="booking.create",
                        title="Criar agendamento",
                        toolName="create_booking",
                        toolArgs={
                            "name": merged.get("name"),
                            "phone": merged.get("phone"),
                            "service": merged.get("service"),
                            "date": merged.get("date"),
                            "time": merged.get("time"),
                            "slot_id": merged.get("slot_id"),
                        },
                    )
                )

            return filtered_steps

        # Injeta os args conhecidos nos steps relevantes
        for step in steps:
            if step.toolName == "list_available_slots" and merged.get("date"):
                step.toolArgs = {"date": merged["date"]}
            elif step.toolName == "create_booking":
                step.toolArgs = {k: merged.get(k) for k in ["name", "phone", "service", "date"]}
            elif step.toolName in ("find_booking", "delete_booking", "list_appointments"):
                step.toolArgs = {"phone": merged.get("phone")}
        return steps

    def _ask_next(self, missing: list[MissingField]) -> str:
        return missing[0].question  # pergunta um campo por vez

    def _friendly_rule_error(self, error: Optional[str]) -> str:
        if not error:
            return "Preciso de mais alguns dados para seguir com seu atendimento."

        if "Data '" in error and "formato inválido" in error:
            return "Consegue me enviar a data no formato DD/MM/AAAA? Ex.: 30/07/2026."
        if "data passada" in error:
            return "Essa data já passou. Qual data futura você prefere para a consulta?"
        if "não atende" in error:
            return "Nesse dia a clínica está fechada. Posso te ajudar a escolher outro dia útil?"

        return "Preciso confirmar alguns dados para seguir com o agendamento."

    def _confirm_summary(self, intent: str, merged: dict) -> str:
        if intent == "book":
            date_label = self._format_date_for_user(merged.get("date"))
            return (f"Vou agendar {merged.get('service','consulta')} para {merged.get('name','você')} "
                    f"em {date_label}. Confirma?")
        if intent == "cancel":
            return "Vou cancelar seu agendamento. Confirma?"
        if intent == "query":
            return "Vou buscar seus agendamentos."
        if intent == "services":
            return "Vou te mostrar os serviços e preços da clínica."
        return "Como posso ajudar?"

    def _build_services_reply(self, execute_result: dict) -> str:
        try:
            tool_results = execute_result.get("toolResults", [])
            services = []
            for item in tool_results:
                result = item.get("result", {}) if isinstance(item, dict) else {}
                if isinstance(result, dict) and isinstance(result.get("services"), list):
                    services = result.get("services", [])
                    break

            if not services:
                return "No momento não consegui carregar o catálogo de serviços. Pode tentar novamente em instantes?"

            lines = ["Estes são os serviços da Clínica Odonto Demo:", ""]
            for svc in services:
                if not isinstance(svc, dict):
                    continue
                name = str(svc.get("name", "Serviço"))
                description = str(svc.get("description", "")).strip()
                duration = svc.get("durationMinutes")
                price = svc.get("priceReais")

                duration_label = f"{duration}min" if isinstance(duration, int) else "duração variável"
                if isinstance(price, (int, float)):
                    price_label = f"R$ {int(price)}" if price > 0 else "incluso"
                else:
                    price_label = "sob consulta"

                lines.append(f"- {name}: {price_label} ({duration_label})")
                if description:
                    lines.append(f"  {description}")

            lines.append("")
            lines.append("Se quiser, já posso te ajudar a escolher um serviço e agendar um horário.")
            return "\n".join(lines)
        except Exception:
            return "No momento não consegui carregar o catálogo de serviços. Pode tentar novamente em instantes?"

    def _build_slots_reply(self, execute_result: dict) -> Optional[str]:
        try:
            tool_results = execute_result.get("toolResults", []) if isinstance(execute_result, dict) else []
            if not isinstance(tool_results, list):
                return None

            slots_payload = None
            for item in tool_results:
                if not isinstance(item, dict):
                    continue
                if item.get("tool") != "list_available_slots":
                    continue
                result = item.get("result", {})
                if isinstance(result, dict) and not result.get("error"):
                    slots_payload = result
                    break

            if not isinstance(slots_payload, dict):
                return None

            date_label = self._format_date_for_user(slots_payload.get("date"))

            morning = slots_payload.get("available_morning_times", [])
            afternoon = slots_payload.get("available_afternoon_times", [])
            all_times = slots_payload.get("available_slots", [])

            if not isinstance(morning, list):
                morning = []
            if not isinstance(afternoon, list):
                afternoon = []
            if not isinstance(all_times, list):
                all_times = []

            if not morning and not afternoon:
                # fallback: converte slot_id para HH:MM quando só vier available_slots
                fallback_times = []
                for slot_id in all_times:
                    text = str(slot_id)
                    if re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{4}", text):
                        fallback_times.append(f"{text[11:13]}:{text[13:15]}")
                fallback_times = sorted(set(fallback_times))
                if not fallback_times:
                    return f"No momento não encontrei horários livres em {date_label}. Quer tentar outra data?"
                times_text = ", ".join(fallback_times)
                return f"Tenho estes horários livres em {date_label}: {times_text}. Qual você prefere?"

            lines = [f"Tenho estes horários livres em {date_label}:"]
            if morning:
                lines.append(f"- Manhã: {', '.join(str(t) for t in morning)}")
            if afternoon:
                lines.append(f"- Tarde: {', '.join(str(t) for t in afternoon)}")
            lines.append("Qual horário você prefere?")
            return "\n".join(lines)
        except Exception:
            return None

    def _should_reset_session_context(self, intent: str, execute_result: dict) -> bool:
        if intent not in {"book", "cancel"}:
            return False

        tool_results = execute_result.get("toolResults", []) if isinstance(execute_result, dict) else []
        if not isinstance(tool_results, list):
            return False

        expected_tool = "create_booking" if intent == "book" else "delete_booking"
        for item in tool_results:
            if not isinstance(item, dict):
                continue
            if item.get("tool") != expected_tool:
                continue
            result = item.get("result", {})
            if isinstance(result, dict) and result.get("error"):
                return False
            return True

        return False

    def _normalize_patient_fields(self, merged: dict, message: str) -> dict:
        normalized = dict(merged)
        had_date_in_message = self._message_has_date(message)
        has_time_in_message = self._message_has_explicit_time(message)

        normalized_date = self._normalize_date_value(normalized.get("date"))
        if not normalized_date:
            normalized_date = self._extract_date_from_text(message)
        if normalized_date:
            normalized["date"] = normalized_date

        normalized_time = self._normalize_time_value(normalized.get("time"))
        if not normalized_time:
            normalized_time = self._extract_time_from_text(message)
        if normalized_time:
            normalized["time"] = normalized_time
        else:
            normalized.pop("time", None)

        slot_id = self._normalize_slot_id(normalized.get("slot_id"))
        if not slot_id and normalized.get("date") and normalized.get("time"):
            slot_id = f"{normalized['date']}_{normalized['time']}"
        if slot_id:
            normalized["slot_id"] = slot_id
        else:
            normalized.pop("slot_id", None)

        # Se o usuário acabou de informar apenas a data, não reutilizar horário antigo.
        if had_date_in_message and not has_time_in_message:
            normalized.pop("time", None)
            normalized.pop("slot_id", None)

        return normalized

    def _normalize_slot_id(self, raw_value: Optional[str]) -> Optional[str]:
        if not raw_value:
            return None
        text = str(raw_value).strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{4}", text):
            return text
        return None

    def _normalize_date_value(self, raw_value: Optional[str]) -> Optional[str]:
        if not raw_value:
            return None

        text = str(raw_value).strip().lower()
        text = re.sub(r"\b(dia|data)\b", "", text).strip()

        # ISO: YYYY-MM-DD
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            try:
                d = datetime.strptime(text, "%Y-%m-%d").date()
                return d.strftime("%Y-%m-%d")
            except ValueError:
                return None

        # BR: DD/MM[/AA|AAAA]
        match = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?", text)
        if not match:
            return None

        day = int(match.group(1))
        month = int(match.group(2))
        year_part = match.group(3)

        current_year = datetime.now().year
        if year_part is None:
            year = current_year
        elif len(year_part) == 2:
            year = 2000 + int(year_part)
        else:
            year = int(year_part)

        try:
            d = date(year, month, day)
            return d.strftime("%Y-%m-%d")
        except ValueError:
            return None

    def _extract_date_from_text(self, message: str) -> Optional[str]:
        text = (message or "").lower()
        match = re.search(r"(\d{1,2}/\d{1,2}(?:/\d{2}|/\d{4})?)", text)
        if not match:
            return None
        return self._normalize_date_value(match.group(1))

    def _normalize_time_value(self, raw_value: Optional[str]) -> Optional[str]:
        if not raw_value:
            return None

        text = str(raw_value).strip().lower()
        text = text.replace("horas", "h").replace("hora", "h")
        text = text.replace(" ", "")
        # Formatos aceitos: 08h00, 08h, 08:00, 8:00, 0800, 8h30
        if re.fullmatch(r"\d{4}", text):
            hour = int(text[:2])
            minute = int(text[2:])
        else:
            m = re.fullmatch(r"(\d{1,2})(?:h|:)(\d{2})?", text)
            if not m:
                return None
            hour = int(m.group(1))
            minute = int(m.group(2) or "00")

        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            return None

        return f"{hour:02d}{minute:02d}"

    def _extract_time_from_text(self, message: str) -> Optional[str]:
        text = (message or "").lower().strip()
        m = re.search(r"\b\d{1,2}(?:\s*(?::|h)\s*\d{2}|\s*h(?:oras?)?)\b|(?<![\d/-])\d{4}(?![\d/-])", text)
        if not m:
            return None
        return self._normalize_time_value(m.group(0))

    def _message_has_explicit_time(self, message: str) -> bool:
        text = (message or "").lower()
        return bool(
            re.search(
                r"\b\d{1,2}(?:\s*(?::|h)\s*\d{2}|\s*h(?:oras?)?)\b|(?<![\d/-])\d{4}(?![\d/-])",
                text,
            )
        )

    def _message_has_date(self, message: str) -> bool:
        text = (message or "").lower()
        return bool(re.search(r"\b\d{1,2}/\d{1,2}(?:/\d{2}|/\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b", text))

    def _is_greeting(self, message: str) -> bool:
        text = (message or "").strip().lower()
        return text in {"oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "eai", "e aí"}

    def _has_active_booking_context(self, memory: dict) -> bool:
        # Se já tem campos de agendamento, manter o contexto atual.
        return any(memory.get(k) for k in ("name", "phone", "service", "date", "time", "slot_id"))

    def _format_date_for_user(self, iso_date: Optional[str]) -> str:
        if not iso_date:
            return "a data informada"
        try:
            d = datetime.strptime(iso_date, "%Y-%m-%d").date()
            return d.strftime("%d/%m/%Y")
        except ValueError:
            return str(iso_date)

    def _generate_reply(self, context: dict) -> str:
        prompt = f"""
Você é a assistente de uma clínica odontológica no Brasil.
Responda em português do Brasil, de forma breve, simpática e objetiva.
Regras obrigatórias:
- Não use tom formal excessivo (evite "Prezado", "Atenciosamente", assinatura, colchetes como [Seu nome]).
- Não use aspas envolvendo a mensagem inteira.
- Se faltar informação para concluir, peça apenas o próximo dado necessário.
- Se o usuário informou só a data, ofereça horários disponíveis e peça a escolha do horário.
Contexto: {json.dumps(context, ensure_ascii=False)}
Gere apenas a mensagem final para o paciente, sem explicações adicionais.
"""
        return self.llm.complete(prompt).strip()