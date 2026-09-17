"use client";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function DataTableColumnHeader<TData, TValue>({ column, title, className }: React.HTMLAttributes<HTMLDivElement> & { column: Column<TData, TValue>; title: string }) {
  if (!column.getCanSort()) return <div className={cn(className)}>{title}</div>;
  const sorted = column.getIsSorted();
  return <Button type="button" variant="ghost" size="sm" className={cn("h-8 px-2", className)} onClick={() => column.toggleSorting(sorted === "asc")}>{title}{sorted === "desc" ? <ArrowDown /> : sorted === "asc" ? <ArrowUp /> : <ChevronsUpDown />}</Button>;
}
