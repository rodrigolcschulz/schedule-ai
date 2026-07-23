import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  cancelBooking,
  createBooking,
  fetchServices,
  fetchSlots,
  listAppointments,
  type Appointment,
  type DentalService,
  type SlotRow,
} from "../api";
import { formatBookingWhenBr, formatSlotTimeBr, SCHEDULE_HINT } from "../schedule";

function todayYmd(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    (d.getMonth() + 1).toString().padStart(2, "0"),
    d.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function Home() {
  const [date, setDate] = useState(todayYmd);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [services, setServices] = useState<DentalService[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      setSlots(await fetchSlots(date));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro ao carregar horários");
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadServices = useCallback(async () => {
    try {
      const svcs = await fetchServices();
      setServices(svcs);
      if (svcs.length && !serviceId) setServiceId(svcs[0].id);
    } catch {
      /* silencioso */
    }
  }, [serviceId]);

  const loadAppointments = useCallback(async () => {
    try {
      setAppointments(await listAppointments());
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => { void loadSlots(); }, [loadSlots]);
  useEffect(() => { void loadServices(); }, [loadServices]);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);

  const freeSlots = useMemo(() => slots.filter((s) => s.available), [slots]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId]
  );

  async function onBook(slot: SlotRow) {
    setMsg(null);
    if (!name.trim() || !phone.trim()) {
      setMsg("Preencha nome e telefone.");
      return;
    }
    if (!serviceId) {
      setMsg("Selecione o serviço.");
      return;
    }
    setLoading(true);
    try {
      await createBooking({
        slotId: slot.id,
        customerName: name.trim(),
        phone: phone.trim(),
        serviceId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      await loadSlots();
      await loadAppointments();
      setMsg("Atendimento agendado com sucesso!");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro ao agendar");
    } finally {
      setLoading(false);
    }
  }

  async function onCancel(bookingId: string) {
    setLoading(true);
    setMsg(null);
    try {
      await cancelBooking(bookingId);
      await loadSlots();
      await loadAppointments();
      setMsg("Atendimento cancelado.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro ao cancelar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Clínica Odonto Demo</h1>
        <p className="muted">
          Agende atendimentos, veja horários disponíveis e gerencie serviços.
          Mesmo backend usado no WhatsApp (stub) e no{" "}
          <Link to="/chat">chat com IA</Link>.
        </p>
      </header>

      {/* Dados do paciente */}
      <section className="card muted-card">
        <h2>Seus dados</h2>
        <div className="row">
          <label className="field grow">
            <span>Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
            />
          </label>
          <label className="field grow">
            <span>Telefone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="5511999999999"
            />
          </label>
        </div>
      </section>

      {/* Serviços */}
      <section className="card">
        <h2>Serviços</h2>
        <label className="field grow">
          <span>Serviço</span>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.priceReais > 0 ? ` — R$ ${s.priceReais}` : " — incluso"}
                {` (${s.durationMinutes}min)`}
              </option>
            ))}
          </select>
        </label>
        {selectedService && (
          <p className="muted small marg-top">{selectedService.description}</p>
        )}
        <label className="field marg-top">
          <span>Observações (opcional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: dor no dente 36, retorno de extração…"
          />
        </label>
      </section>

      {/* Agendamento */}
      <section className="card">
        <h2>Novo agendamento</h2>
        <label className="field">
          <span>Data</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {msg && <p className="banner">{msg}</p>}
        <p className="muted small">{SCHEDULE_HINT}</p>
        {loading ? (
          <p className="muted">Carregando…</p>
        ) : (
          <ul className="slot-list">
            {freeSlots.length === 0 ? (
              <li className="muted">Nenhum horário livre neste dia.</li>
            ) : (
              freeSlots.map((s) => (
                <li key={s.id} className="slot-item">
                  <span>
                    {formatSlotTimeBr(s.startsAt)}{" "}
                    <span className="muted">(Brasília)</span>
                  </span>
                  <button type="button" onClick={() => void onBook(s)}>
                    Agendar
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      {/* Atendimentos agendados */}
      <section className="card">
        <h2>Atendimentos agendados</h2>
        <button type="button" className="ghost" onClick={() => void loadAppointments()}>
          Atualizar lista
        </button>
        <ul className="booking-list">
          {appointments.length === 0 ? (
            <li className="muted">Nenhum atendimento agendado ainda.</li>
          ) : (
            appointments.map((a) => (
              <li key={a.id} className="booking-item">
                <div>
                  <strong>{a.patientName}</strong>
                  <span className="muted small block">
                    {formatBookingWhenBr(a.startsAt)} · {a.phone}
                  </span>
                  <span className="small block">{a.serviceName}</span>
                  {a.notes && (
                    <span className="muted small block">Obs: {a.notes}</span>
                  )}
                  <code className="small">{a.bookingId.slice(0, 8)}…</code>
                </div>
                <button
                  type="button"
                  onClick={() => void onCancel(a.bookingId)}
                >
                  Cancelar
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
