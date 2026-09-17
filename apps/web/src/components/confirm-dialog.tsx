"use client";

import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  desc: React.ReactNode;
  cancelBtnText?: string;
  confirmText?: React.ReactNode;
  destructive?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  handleConfirm: () => void;
};

export function ConfirmDialog({ title, desc, children, className, confirmText, cancelBtnText, destructive, isLoading, disabled, handleConfirm, ...actions }: ConfirmDialogProps) {
  return <AlertDialog {...actions}>
    <AlertDialogContent className={cn(className)}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription asChild><div>{desc}</div></AlertDialogDescription></AlertDialogHeader>
      {children}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isLoading}>{cancelBtnText ?? "Cancel"}</AlertDialogCancel>
        <Button type="button" onClick={handleConfirm} variant={destructive ? "destructive" : "default"} disabled={disabled || isLoading}>{confirmText ?? "Continue"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
