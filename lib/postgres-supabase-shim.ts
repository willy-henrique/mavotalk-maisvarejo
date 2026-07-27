import type { QueryResult } from "pg";
import { getDatabasePool, queryTenantDatabase, requireTenantOrganizationId } from "@/lib/db";

// Database rows are schema-less at this adapter boundary and are normalized by
// the repository before reaching the rest of the application.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

type SelectMode = "*" | string[];
type OrderBy = { column: string; ascending: boolean };
type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "ilike"; column: string; value: string }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "not"; column: string; operator: string; value: unknown };

type Operation = "select" | "insert" | "update" | "delete";

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function runQuery<T extends Row>(
  sql: string,
  values: unknown[],
  organizationId?: string,
): Promise<{ data: T[] | null; error: unknown | null }> {
  try {
    const result: QueryResult<T> = organizationId
      ? await queryTenantDatabase<T>(organizationId, sql, values)
      : await getDatabasePool().query<T>(sql, values);
    return { data: result.rows, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

class PgQueryBuilder {
  private readonly table: string;
  private readonly organizationId?: string;
  private operation: Operation = "select";
  private selectMode: SelectMode = "*";
  private filters: Filter[] = [];
  private orderBy: OrderBy | null = null;
  private rowLimit: number | null = null;
  private insertPayload: Row[] | null = null;
  private updatePayload: Row | null = null;
  private returningAfterMutation = false;

  constructor(table: string, organizationId?: string) {
    this.table = table;
    this.organizationId = organizationId;
  }

  select(columns: string): this {
    const normalized = columns.trim();
    this.selectMode = normalized === "*" ? "*" : normalized.split(",").map((c) => c.trim());
    if (this.operation !== "select") {
      this.returningAfterMutation = true;
    }
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.operation = "insert";
    this.insertPayload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload: Row): this {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  ilike(column: string, value: string): this {
    this.filters.push({ kind: "ilike", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ kind: "not", column, operator, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(limit: number): this {
    this.rowLimit = limit;
    return this;
  }

  async maybeSingle<T extends Row = Row>(): Promise<{ data: T | null; error: unknown | null }> {
    const { data, error } = await this.execute<T>();
    if (error) return { data: null, error };
    return { data: (data?.[0] ?? null) as T | null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: unknown | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: unknown | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhere(values: unknown[]): string {
    if (this.filters.length === 0) return "";
    const clauses: string[] = [];
    for (const filter of this.filters) {
      if (filter.kind === "eq") {
        values.push(filter.value);
        clauses.push(`${quoteIdent(filter.column)} = $${values.length}`);
        continue;
      }
      if (filter.kind === "neq") {
        values.push(filter.value);
        clauses.push(`${quoteIdent(filter.column)} <> $${values.length}`);
        continue;
      }
      if (filter.kind === "ilike") {
        values.push(filter.value);
        clauses.push(`${quoteIdent(filter.column)} ILIKE $${values.length}`);
        continue;
      }
      if (filter.kind === "in") {
        if (filter.values.length === 0) {
          clauses.push("FALSE");
          continue;
        }
        const marks: string[] = [];
        for (const item of filter.values) {
          values.push(item);
          marks.push(`$${values.length}`);
        }
        clauses.push(`${quoteIdent(filter.column)} IN (${marks.join(", ")})`);
        continue;
      }
      if (filter.kind === "not") {
        if (filter.operator === "is") {
          if (filter.value === null) {
            clauses.push(`${quoteIdent(filter.column)} IS NOT NULL`);
          } else {
            values.push(filter.value);
            clauses.push(`${quoteIdent(filter.column)} IS DISTINCT FROM $${values.length}`);
          }
          continue;
        }
        values.push(filter.value);
        clauses.push(`${quoteIdent(filter.column)} <> $${values.length}`);
      }
    }
    return ` WHERE ${clauses.join(" AND ")}`;
  }

  private selectColumns(): string {
    if (this.selectMode === "*") return "*";
    if (this.selectMode.length === 0) return "*";
    return this.selectMode.map((c) => quoteIdent(c)).join(", ");
  }

  private async execute<T extends Row = Row>(): Promise<{ data: T[] | null; error: unknown | null }> {
    const values: unknown[] = [];
    if (this.operation === "select") {
      let sql = `SELECT ${this.selectColumns()} FROM ${quoteIdent(this.table)}`;
      sql += this.buildWhere(values);
      if (this.orderBy) {
        sql += ` ORDER BY ${quoteIdent(this.orderBy.column)} ${this.orderBy.ascending ? "ASC" : "DESC"}`;
      }
      if (this.rowLimit != null) {
        values.push(this.rowLimit);
        sql += ` LIMIT $${values.length}`;
      }
      return runQuery<T>(sql, values, this.organizationId);
    }

    if (this.operation === "insert") {
      const rows = this.insertPayload ?? [];
      if (rows.length === 0) return { data: [], error: null };

      const columns = Array.from(
        rows.reduce<Set<string>>((acc, row) => {
          Object.keys(row).forEach((key) => acc.add(key));
          return acc;
        }, new Set<string>()),
      );

      const valueGroups: string[] = [];
      for (const row of rows) {
        const marks: string[] = [];
        for (const column of columns) {
          values.push(row[column] ?? null);
          marks.push(`$${values.length}`);
        }
        valueGroups.push(`(${marks.join(", ")})`);
      }

      let sql = `INSERT INTO ${quoteIdent(this.table)} (${columns.map((c) => quoteIdent(c)).join(", ")}) VALUES ${valueGroups.join(", ")}`;
      if (this.returningAfterMutation) {
        sql += ` RETURNING ${this.selectColumns()}`;
      }
      return runQuery<T>(sql, values, this.organizationId);
    }

    if (this.operation === "update") {
      const updates = this.updatePayload ?? {};
      const columns = Object.keys(updates);
      if (columns.length === 0) return { data: [], error: null };

      const setSql = columns.map((column) => {
        values.push(updates[column]);
        return `${quoteIdent(column)} = $${values.length}`;
      });

      let sql = `UPDATE ${quoteIdent(this.table)} SET ${setSql.join(", ")}`;
      sql += this.buildWhere(values);
      if (this.returningAfterMutation) {
        sql += ` RETURNING ${this.selectColumns()}`;
      }
      return runQuery<T>(sql, values, this.organizationId);
    }

    let sql = `DELETE FROM ${quoteIdent(this.table)}`;
    sql += this.buildWhere(values);
    if (this.returningAfterMutation) {
      sql += ` RETURNING ${this.selectColumns()}`;
    }
    return runQuery<T>(sql, values, this.organizationId);
  }
}

export type SupabaseLikeClient = {
  from: (table: string) => PgQueryBuilder;
};

export function createPostgresSupabaseShim(): SupabaseLikeClient {
  return {
    from(table: string) {
      return new PgQueryBuilder(table);
    },
  };
}

/**
 * Cliente para fluxos que já conhecem a organização. Cada consulta instala
 * `app.organization_id` antes do SQL para que RLS complemente os filtros
 * explícitos do repositório.
 */
export function createTenantPostgresSupabaseShim(
  organizationId: string,
): SupabaseLikeClient {
  const tenantId = requireTenantOrganizationId(organizationId);
  return {
    from(table: string) {
      return new PgQueryBuilder(table, tenantId);
    },
  };
}
