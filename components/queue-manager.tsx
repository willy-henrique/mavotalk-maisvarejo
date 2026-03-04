/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Queue } from "@/types";

const defaultForm = {
  name: "",
  menuOption: 1,
  colorHex: "#0EA5E9",
  defaultSlaMins: 30,
};

export function QueueManager() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [form, setForm] = useState(defaultForm);

  async function loadQueues() {
    const response = await fetch("/api/queues", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setQueues(payload.queues);
  }

  useEffect(() => {
    void loadQueues();
  }, []);

  async function createQueue(event: FormEvent) {
    event.preventDefault();

    await fetch("/api/queues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setForm(defaultForm);
    await loadQueues();
  }

  async function toggleQueue(queue: Queue) {
    await fetch(`/api/queues/${queue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !queue.isActive }),
    });
    await loadQueues();
  }

  return (
    <div className="queue-manager">
      <header>
        <h1>Demandas e Triagem</h1>
        <a href="/dashboard">Voltar para operação</a>
      </header>

      <form className="queue-form" onSubmit={createQueue}>
        <input
          placeholder="Nome da demanda"
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          required
        />
        <input
          type="number"
          min={1}
          max={99}
          value={form.menuOption}
          onChange={(event) => setForm((prev) => ({ ...prev, menuOption: Number(event.target.value) }))}
          required
        />
        <input
          type="color"
          value={form.colorHex}
          onChange={(event) => setForm((prev) => ({ ...prev, colorHex: event.target.value }))}
        />
        <input
          type="number"
          min={5}
          max={1440}
          value={form.defaultSlaMins}
          onChange={(event) => setForm((prev) => ({ ...prev, defaultSlaMins: Number(event.target.value) }))}
          required
        />
        <button type="submit">Cadastrar demanda</button>
      </form>

      <div className="queue-list">
        {queues.map((queue) => (
          <article key={queue.id} className="queue-item">
            <div className="left">
              <span className="dot" style={{ background: queue.colorHex }} />
              <strong>
                {queue.menuOption} - {queue.name}
              </strong>
            </div>
            <div className="right">
              <span>SLA {queue.defaultSlaMins} min</span>
              <button type="button" onClick={() => toggleQueue(queue)}>
                {queue.isActive ? "Desativar" : "Ativar"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

