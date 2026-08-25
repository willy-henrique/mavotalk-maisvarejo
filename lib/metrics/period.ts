export const MAX_PERIOD_DAYS = 90;
const DIA_MS = 24 * 60 * 60 * 1000;

const NOMES = ["hoje", "ontem", "semana", "mes", "7d", "30d", "90d", "custom"] as const;
export type PeriodName = (typeof NOMES)[number];

export class PeriodError extends Error {
  constructor(
    public readonly code: "invalid_period" | "period_too_long",
    message: string,
  ) {
    super(message);
    this.name = "PeriodError";
  }
}

export type ResolvedPeriod = {
  from: Date;
  to: Date;
  comparison: { from: Date; to: Date };
  timezone: string;
};

type DataCivil = { ano: number; mes: number; dia: number };
const PADRAO_DATA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

function criarFormatador(timezone: string): Intl.DateTimeFormat {
  try {
    const formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatador.format(new Date(0));
    return formatador;
  } catch {
    throw new PeriodError("invalid_period", `Fuso horário inválido: ${timezone}`);
  }
}

function dataCivil(instante: Date, formatador: Intl.DateTimeFormat): DataCivil {
  if (Number.isNaN(instante.getTime())) {
    throw new PeriodError("invalid_period", "Data inválida");
  }

  const partes = Object.fromEntries(
    formatador
      .formatToParts(instante)
      .filter((parte) => parte.type === "year" || parte.type === "month" || parte.type === "day")
      .map((parte) => [parte.type, Number(parte.value)]),
  );

  return { ano: partes.year, mes: partes.month, dia: partes.day };
}

function chaveDaData(data: DataCivil): number {
  return Date.UTC(data.ano, data.mes - 1, data.dia);
}

function somaDiasCivis(data: DataCivil, dias: number): DataCivil {
  const resultado = new Date(Date.UTC(data.ano, data.mes - 1, data.dia + dias));
  return {
    ano: resultado.getUTCFullYear(),
    mes: resultado.getUTCMonth() + 1,
    dia: resultado.getUTCDate(),
  };
}

function dataCivilDaEntrada(valor: string): DataCivil | null {
  const correspondencia = PADRAO_DATA_CIVIL.exec(valor);
  if (!correspondencia) return null;

  const data = {
    ano: Number(correspondencia[1]),
    mes: Number(correspondencia[2]),
    dia: Number(correspondencia[3]),
  };
  const conferida = new Date(chaveDaData(data));
  if (
    conferida.getUTCFullYear() !== data.ano ||
    conferida.getUTCMonth() + 1 !== data.mes ||
    conferida.getUTCDate() !== data.dia
  ) {
    throw new PeriodError("invalid_period", "Datas inválidas");
  }
  return data;
}

/** Primeiro instante pertencente à data civil no fuso da organização. */
function inicioDaData(data: DataCivil, formatador: Intl.DateTimeFormat): Date {
  const alvo = chaveDaData(data);
  let inferior = alvo - 36 * 60 * 60 * 1000;
  let superior = alvo + 36 * 60 * 60 * 1000;

  while (superior - inferior > 1) {
    const meio = Math.floor((inferior + superior) / 2);
    const chaveNoMeio = chaveDaData(dataCivil(new Date(meio), formatador));
    if (chaveNoMeio < alvo) inferior = meio;
    else superior = meio;
  }

  if (chaveDaData(dataCivil(new Date(superior), formatador)) !== alvo) {
    throw new PeriodError("invalid_period", "A data não existe no fuso informado");
  }

  return new Date(superior);
}

export function resolvePeriod(input: {
  name?: string;
  from?: string;
  to?: string;
  timezone: string;
  now?: Date;
}): ResolvedPeriod {
  const nome = (input.name ?? "hoje") as PeriodName;
  if (!NOMES.includes(nome)) {
    throw new PeriodError("invalid_period", `Período desconhecido: ${input.name}`);
  }

  const formatador = criarFormatador(input.timezone);
  let from: Date;
  let to: Date;

  if (nome === "custom") {
    if (!input.from || !input.to) {
      throw new PeriodError("invalid_period", "Período personalizado exige from e to");
    }
    const fromCivil = dataCivilDaEntrada(input.from);
    const toCivil = dataCivilDaEntrada(input.to);
    from = fromCivil ? inicioDaData(fromCivil, formatador) : new Date(input.from);
    to = toCivil ? inicioDaData(toCivil, formatador) : new Date(input.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new PeriodError("invalid_period", "Datas inválidas");
    }
    if (to.getTime() <= from.getTime()) {
      throw new PeriodError("invalid_period", "A data final precisa ser depois da inicial");
    }
    const diasCivis =
      fromCivil && toCivil ? (chaveDaData(toCivil) - chaveDaData(fromCivil)) / DIA_MS : null;
    const excedeTeto =
      diasCivis === null
        ? to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DIA_MS
        : diasCivis > MAX_PERIOD_DAYS;
    if (excedeTeto) {
      throw new PeriodError(
        "period_too_long",
        `A consulta cobre no máximo ${MAX_PERIOD_DAYS} dias`,
      );
    }
  } else {
    const hoje = dataCivil(input.now ?? new Date(), formatador);
    const dias =
      nome === "hoje" || nome === "ontem"
        ? 1
        : nome === "semana"
          ? 7
          : nome === "mes"
            ? 30
            : Number(nome.replace("d", ""));
    const fimCivil = nome === "ontem" ? hoje : somaDiasCivis(hoje, 1);
    const inicioCivil = somaDiasCivis(fimCivil, -dias);

    from = inicioDaData(inicioCivil, formatador);
    to = inicioDaData(fimCivil, formatador);
  }

  const duracao = to.getTime() - from.getTime();
  return {
    from,
    to,
    comparison: { from: new Date(from.getTime() - duracao), to: from },
    timezone: input.timezone,
  };
}
