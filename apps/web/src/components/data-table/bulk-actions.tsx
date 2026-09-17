"use client";
import type { Table } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
export function DataTableBulkActions<TData>({ table, entityName, children }: { table: Table<TData>; entityName: string; children: React.ReactNode }) {
  const count = table.getFilteredSelectedRowModel().rows.length;
  if (!count) return null;
  return <div role="toolbar" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background p-2 shadow-xl"><Button type="button" variant="outline" size="icon" className="size-7" onClick={() => table.resetRowSelection()} aria-label="Clear selection"><X /></Button><span className="text-sm">{count} {entityName}{count > 1 ? "s" : ""} selected</span>{children}</div>;
}
