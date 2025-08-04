import { randomUUID } from "node:crypto";
import { z } from "zod";

export function generateExecutionId(): string {
  return randomUUID();
}

export const jsonString = z.string().transform((str, ctx) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: "Invalid JSON" });
    return z.NEVER;
  }
});
