import {
  checkbox,
  confirm,
  input,
  number,
  password,
  select,
} from "@inquirer/prompts";

export interface PromptAdapter {
  checkbox: typeof checkbox;
  confirm: typeof confirm;
  input: typeof input;
  number: typeof number;
  password: typeof password;
  select: typeof select;
}

export function defaultPrompts(): PromptAdapter {
  return { checkbox, confirm, input, number, password, select };
}

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
