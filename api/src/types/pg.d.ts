declare module "pg" {
  export interface QueryResult<R = any> {
    rows: R[];
    rowCount: number | null;
  }

  export class Pool {
    constructor(config?: Record<string, unknown>);
    query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}