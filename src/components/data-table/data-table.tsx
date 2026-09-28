import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildQueryString, type RawSearchParams, resultRange } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  className?: string;
  /** Célula renderizada no desktop (também usada no mobile se não houver `mobile`). */
  cell: (row: T) => ReactNode;
  /** Versão compacta para telas pequenas. */
  mobile?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
};

type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  getRowId: (row: T) => string;
  /** Rota base para os links de paginação. */
  basePath: string;
  searchParams: RawSearchParams;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  emptyTitle: string;
  emptyDescription?: string;
  /** Ação exibida no estado vazio (ex.: botão "novo"). */
  emptyAction?: ReactNode;
  rowHref?: (row: T) => string;
};

/**
 * Tabela de listagem padrão do sistema.
 *
 * Sem biblioteca de tabela: os dados já chegam paginados do servidor e todo o
 * estado (busca, filtro, ordenação, página) vive na URL.
 *
 * No mobile a tabela vira uma lista de cartões — o almoxarife usa celular no
 * balcão (AGENTS.md §6).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  basePath,
  searchParams,
  page,
  pageSize,
  total,
  totalPages: totalPageCount,
  emptyTitle,
  emptyDescription,
  emptyAction,
  rowHref,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
        <div className="space-y-1">
          <p className="font-medium">{emptyTitle}</p>
          {emptyDescription ? (
            <p className="text-muted-foreground text-sm">{emptyDescription}</p>
          ) : null}
        </div>
        {emptyAction}
      </div>
    );
  }

  const alignClass = (align: Column<T>["align"]) =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <div className="space-y-3">
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(alignClass(column.align), column.className)}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              const id = getRowId(row);

              return (
                <TableRow key={id} className={href ? "cursor-pointer" : undefined}>
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={cn(alignClass(column.align), column.className)}
                    >
                      {href && index === 0 ? (
                        <Link href={href} className="font-medium hover:underline">
                          {column.cell(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => {
          const href = rowHref?.(row);
          const content = (
            <div className="space-y-1.5">
              {columns.map((column) => (
                <div key={column.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground shrink-0 text-xs">{column.header}</span>
                  <span className="text-right">{column.mobile?.(row) ?? column.cell(row)}</span>
                </div>
              ))}
            </div>
          );

          return (
            <li key={getRowId(row)} className="rounded-lg border p-3">
              {href ? (
                <Link href={href} className="block">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{resultRange(page, pageSize, total)}</p>

        {totalPageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link
                href={`${basePath}${buildQueryString(searchParams, { pagina: page - 1 })}`}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
              >
                Anterior
              </Link>
            </Button>

            <span className="text-muted-foreground text-sm">
              Página {page} de {totalPageCount}
            </span>

            <Button asChild variant="outline" size="sm" disabled={page >= totalPageCount}>
              <Link
                href={`${basePath}${buildQueryString(searchParams, { pagina: page + 1 })}`}
                aria-disabled={page >= totalPageCount}
                tabIndex={page >= totalPageCount ? -1 : undefined}
              >
                Próxima
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
