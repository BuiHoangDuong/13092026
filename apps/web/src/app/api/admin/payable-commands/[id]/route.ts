import { db } from "@cashback/db";
import { adminJson, withAdmin } from "@/lib/admin-api";
export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const command = await db.payableCommand.findUnique({ where: { id: (await context.params).id } });
  return command ? adminJson({ id: command.id, type: command.type, executionId: command.executionId, status: command.status, result: command.result, createdAt: command.createdAt, finishedAt: command.finishedAt })
    : adminJson({ error: { code: "COMMAND_NOT_FOUND", message: "Command not found" } }, { status: 404 });
});
