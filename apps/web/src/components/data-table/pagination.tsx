"use client";
import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function DataTablePagination<TData>({ table, className }: { table: Table<TData>; className?: string }) {
  const page = table.getState().pagination.pageIndex + 1;
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 px-1", className)}><p className="text-sm text-muted-foreground">Page {page} of {Math.max(table.getPageCount(), 1)} · {table.getFilteredRowModel().rows.length} rows</p><div className="flex items-center gap-2"><label className="text-xs text-muted-foreground">Rows <select className="ml-1 h-8 rounded-md border border-input bg-background px-2" value={table.getState().pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}>{[10, 20, 30, 50].map(size => <option key={size}>{size}</option>)}</select></label><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button></div></div>;
}
