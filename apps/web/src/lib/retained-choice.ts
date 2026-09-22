/** Id to keep selected when it is outside the loaded page. Empty when absent or already listed. */
export function retainedChoiceId(current: string | null | undefined, loadedIds: readonly string[]): string {
  if (!current || loadedIds.includes(current)) return "";
  return current;
}
