"use client";
import type { Column } from "@tanstack/react-table";
export function DataTableFacetedFilter<TData, TValue>({ column, title, options }: { column?: Column<TData, TValue>; title: string; options: { label: string; value: string }[] }) {
  return <label className="text-xs text-muted-foreground">{title}<select className="ml-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={String(column?.getFilterValue() ?? "")} onChange={event => column?.setFilterValue(event.target.value || undefined)}><option value="">All</option>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
}
