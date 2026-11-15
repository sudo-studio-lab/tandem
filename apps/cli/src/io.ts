/** Output and error conventions (clig.dev / gh: data on stdout, messages on stderr, --json for machines). */
import { readFile } from "node:fs/promises";
import { EXIT, TandemError } from "@tandem/contracts";

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function info(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Read `--input <file|->` as JSON. */
export async function readJsonInput(input: string): Promise<unknown> {
  const text = input === "-" ? await readStdin() : await readFile(input, "utf8");
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new TandemError("usage", `--input 不是有效的 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof TandemError) {
    if (e.code === "usage") return EXIT.usage;
    if (e.code === "needs_human") return EXIT.needsHuman;
  }
  return EXIT.error;
}

export function describeError(e: unknown): string {
  if (e instanceof TandemError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
