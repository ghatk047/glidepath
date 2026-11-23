import type { ObjectStore } from '@glidepath/data-access';

/** Who a job runs for (the request's tenant and user). */
export interface ExcelWho {
  readonly tenantId: string;
  readonly userId: string;
}

/** What `excel.export` answers (the worker's `ExportJobResult`, in the terms the routes use). */
export interface ExportJobOutcome {
  readonly id: string;
  readonly templateVersion: string;
  readonly scenarioIds: readonly string[];
  /** Input sheets of the workbook (README, `_lists` and `_meta` are always added). */
  readonly sheets: readonly string[];
  readonly fileName: string;
  readonly checksum: string;
}

export interface ApplyJobPayload {
  readonly importJobId: string;
  readonly accept: 'all' | 'selected';
  readonly decisions: readonly {
    readonly sheet: string;
    readonly key: string;
    readonly member: string;
    readonly scenario: string | null;
    readonly take: 'excel' | 'app';
  }[];
  readonly clientRequestId?: string;
}

/** What `excel.apply` answers (the worker's `ApplyJobResult`, as far as the routes read it). */
export interface ApplyJobOutcome {
  readonly changesetId: string | null;
  readonly applied: {
    readonly scenarios: readonly {
      readonly scenarioId: string | null;
      readonly changesetId: string;
      readonly version: number;
      readonly editsCount: number;
      readonly forkedFrom?: string;
    }[];
    readonly editsCount: number;
    readonly warnings: readonly unknown[];
  };
}

/**
 * The three Excel jobs of the worker tier (XL-08: `excel.export`, `excel.import`, `excel.apply`), as the routes
 * start them. The server composition root wires an implementation (same process: the worker's `run*` functions
 * with `defaultExcelDeps`; or pg-boss); the routes know nothing of how or where they run. Every method runs in its
 * own tenant transaction, so what the route wrote in the request transaction is visible only after it committed.
 */
export interface ExcelJobs {
  /** Builds and stores the workbook and writes the `export_job` row; resolves when both are committed. */
  exportWorkbook(
    who: ExcelWho,
    request: {
      readonly exportJobId: string;
      readonly scenarioIds: readonly string[];
      readonly sheets?: readonly string[];
      readonly format?: 'xlsx' | 'csv';
    },
  ): Promise<ExportJobOutcome>;
  /**
   * Starts the preview of an uploaded workbook (`import_job` row committed, file stored). Returns at once; the
   * job ends the row `awaiting_review` or `failed` (the reason in its report), which `GET imports/:id` shows.
   */
  startImport(who: ExcelWho, importJobId: string): void;
  /** Applies the accepted rows; resolves when the changesets are committed. */
  applyImport(who: ExcelWho, payload: ApplyJobPayload): Promise<ApplyJobOutcome>;
}

export interface ExcelRoutesDeps {
  readonly jobs: ExcelJobs;
  /** The tenant's object store (ADR-025); bytes leave tier 2 only through `GET files/:id`. */
  readonly objects: (who: ExcelWho) => ObjectStore;
  /** Upload cap in bytes; default `importMaxBytes()` (the `IMPORT_MAX_BYTES` setting). */
  readonly maxUploadBytes?: number;
  readonly newId?: () => string;
}
