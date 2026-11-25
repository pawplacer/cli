import chalk from "chalk";

import {
  CONTRACT_TYPES,
  choicesFrom,
  DEFAULT_PET_STATUSES,
  humanize,
  PET_SPECIES,
} from "./constants";
import type { Rendered } from "./output";
import type { ActionContext } from "./program";
import { personTypeChoices } from "./prompts/person";

const ANY = "__any__";
const GUIDE_PAGE_SIZE = 20;

type Context = ActionContext & { apiKey: string };

export async function runGuide(
  context: Context,
  doctor: (context: Context) => Promise<Rendered>,
): Promise<Rendered> {
  const { client, deps } = context;
  const { prompts } = deps;
  deps.stderr.write(
    `${chalk.bold("PawPlacer guide")}\n${chalk.gray(
      "Pick a task and answer a few prompts. Every task here is read-only.",
    )}\n`,
  );

  const task = await prompts.select({
    message: "What do you want to do?",
    choices: [
      { name: "List available pets", value: "pets:available" },
      { name: "Search pets", value: "pets:search" },
      { name: "List pets by status", value: "pets:status" },
      { name: "Show a pet", value: "pets:get" },
      { name: "List pet custom fields", value: "pets:custom-fields" },
      { name: "List people", value: "people:list" },
      { name: "Search people", value: "people:search" },
      { name: "Show a person", value: "people:get" },
      { name: "List people custom fields", value: "people:custom-fields" },
      { name: "Show adoption fees", value: "adoption-fees" },
      { name: "Show a contract", value: "contracts" },
      { name: "Check my API key", value: "doctor" },
    ],
    pageSize: 12,
  });

  const personType = () =>
    prompts.select({ message: "Person type", choices: personTypeChoices() });

  switch (task) {
    case "pets:available": {
      const species = await prompts.select({
        message: "Species",
        choices: [{ name: "Any species", value: ANY }, ...PET_SPECIES],
      });
      return {
        view: "pet-list",
        value: await client.pets.list({
          status: "available",
          species: species === ANY ? undefined : species,
          limit: GUIDE_PAGE_SIZE,
        }),
      };
    }
    case "pets:search":
      return {
        view: "pet-list",
        value: await client.pets.list({
          search: await prompts.input({
            message: "Search for",
            required: true,
          }),
          limit: GUIDE_PAGE_SIZE,
        }),
      };
    case "pets:status":
      return {
        view: "pet-list",
        value: await client.pets.list({
          status: await prompts.select({
            message: "Status",
            choices: choicesFrom(DEFAULT_PET_STATUSES),
            pageSize: 13,
          }),
          limit: GUIDE_PAGE_SIZE,
        }),
      };
    case "pets:get":
      return {
        view: "pet",
        value: await client.pets.get(
          await prompts.input({ message: "Pet ID", required: true }),
        ),
      };
    case "pets:custom-fields":
      return {
        view: "custom-fields",
        value: await client.pets.getCustomFields(),
      };
    case "people:list":
      return {
        view: "person-list",
        value: await client.people.list({
          type: await personType(),
          limit: GUIDE_PAGE_SIZE,
        }),
      };
    case "people:search": {
      const type = await personType();
      return {
        view: "person-list",
        value: await client.people.list({
          type,
          search: await prompts.input({
            message: "Search for",
            required: true,
          }),
          limit: GUIDE_PAGE_SIZE,
        }),
      };
    }
    case "people:get": {
      const type = await personType();
      return {
        view: "person",
        value: await client.people.get(
          await prompts.input({ message: "Person ID", required: true }),
          type,
        ),
      };
    }
    case "people:custom-fields":
      return {
        view: "custom-fields",
        value: await client.people.getCustomFields(await personType()),
      };
    case "adoption-fees":
      return { view: "adoption-fees", value: await client.adoptionFees.get() };
    case "contracts":
      return {
        view: "contract",
        value: await client.contracts.get(
          await prompts.select({
            message: "Contract",
            choices: CONTRACT_TYPES.map((value) => ({
              name: humanize(value),
              value,
            })),
          }),
        ),
      };
    default:
      return doctor(context);
  }
}
