"use client";
import type { Table } from "@tanstack/react-table";
import { Columns3 } from "lucide-react";
export function DataTableViewOptions<TData>({ table }: { table: Table<TData> }) {
  const hideable = table.getAllColumns().filter(column => column.getCanHide());
  if (!hideable.length) return null;
  return <details className="relative"><summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted"><Columns3 className="size-4" />Columns</summary><div className="absolute right-0 z-20 mt-2 min-w-40 rounded-md border border-border bg-popover p-2 shadow-lg">{hideable.map(column => <label className="flex items-center gap-2 px-2 py-1 text-sm capitalize" key={column.id}><input type="checkbox" checked={column.getIsVisible()} onChange={event => column.toggleVisibility(event.target.checked)} />{column.id}</label>)}</div></details>;
}
