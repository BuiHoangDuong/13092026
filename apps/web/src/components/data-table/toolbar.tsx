"use client";
import type { Table } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "./faceted-filter";
import { DataTableViewOptions } from "./view-options";
export type DataTableFilter = { columnId: string; title: string; options: { label: string; value: string }[] };
export function DataTableToolbar<TData>({ table, searchPlaceholder = "Filter...", searchKey, filters = [] }: { table: Table<TData>; searchPlaceholder?: string; searchKey?: string; filters?: DataTableFilter[] }) {
  const value = searchKey ? String(table.getColumn(searchKey)?.getFilterValue() ?? "") : String(table.getState().globalFilter ?? "");
  const setValue = (next: string) => searchKey ? table.getColumn(searchKey)?.setFilterValue(next) : table.setGlobalFilter(next);
  const filtered = Boolean(value || table.getState().columnFilters.length);
  return <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Input className="h-9 w-56" placeholder={searchPlaceholder} value={value} onChange={event => setValue(event.target.value)} />{filters.map(filter => <DataTableFacetedFilter key={filter.columnId} column={table.getColumn(filter.columnId)} title={filter.title} options={filter.options} />)}{filtered && <Button type="button" variant="ghost" size="sm" onClick={() => { table.resetColumnFilters(); table.setGlobalFilter(""); }}>Reset <X /></Button>}</div><DataTableViewOptions table={table} /></div>;
}
