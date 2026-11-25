import type {
  PersonCreateStatus,
  PersonStatus,
  PetAgeCategory,
  PetCompatibility,
  PetHealthStatus,
  PetSex,
  PetSize,
  PetSpecies,
  PetTemperament,
} from "pawplacer-sdk";

export { CONTRACT_TYPES, PERSON_TYPES } from "pawplacer-sdk";

export interface Choice<T extends string = string> {
  name: string;
  value: T;
}

export const PET_SPECIES = [
  { name: "Dog", value: "dog" },
  { name: "Cat", value: "cat" },
  { name: "Rabbit", value: "rabbit" },
  { name: "Horse", value: "horse" },
  { name: "Small & furry", value: "small_furry" },
  { name: "Bird", value: "bird" },
  { name: "Barnyard", value: "barnyard" },
  { name: "Reptile", value: "reptile" },
  { name: "Scales, fins & other", value: "scales_fins_other" },
  { name: "Invertebrate", value: "invertebrate" },
] as const satisfies readonly Choice<PetSpecies>[];

export const PET_AGE_CATEGORIES = [
  { name: "Youngest", value: "youngest" },
  { name: "Young", value: "young" },
  { name: "Adult", value: "adult" },
  { name: "Senior", value: "senior" },
] as const satisfies readonly Choice<PetAgeCategory>[];

export const PET_SEXES = [
  { name: "Male", value: "male" },
  { name: "Female", value: "female" },
  { name: "Unknown", value: "unknown" },
] as const satisfies readonly Choice<PetSex>[];

export const PET_SIZES = [
  { name: "Extra small", value: "xSmall" },
  { name: "Small", value: "small" },
  { name: "Medium", value: "medium" },
  { name: "Large", value: "large" },
  { name: "Extra large", value: "xLarge" },
] as const satisfies readonly Choice<PetSize>[];

export const PET_HEALTH = [
  { name: "Unknown", value: "unknown" },
  { name: "Poor", value: "poor" },
  { name: "Good", value: "good" },
  { name: "Great", value: "great" },
] as const satisfies readonly Choice<PetHealthStatus>[];

export const DEFAULT_PET_STATUSES = [
  "available",
  "intake",
  "stray",
  "fostered",
  "hold",
  "medicalTreatment",
  "adopted",
  "transferred",
  "returnedToOwner",
  "deceased",
  "euthanized",
  "archived",
  "other",
] as const;

export const PET_COMPATIBILITIES = [
  "activeLifestyle",
  "cats",
  "disabledMental",
  "disabledPhysical",
  "dogs",
  "families",
  "firstTimeOwners",
  "frequentTravelers",
  "houseTrained",
  "kids",
  "otherPets",
  "outdoorsLiving",
  "sedentaryLifestyle",
  "seniors",
  "smallApartments",
] as const satisfies readonly PetCompatibility[];

export const PET_TEMPERAMENTS = [
  "affectionate",
  "aggressive",
  "cuddly",
  "curious",
  "docile",
  "energetic",
  "fearful",
  "gentle",
  "independent",
  "loyal",
  "mischievous",
  "moody",
  "playful",
  "protective",
  "quiet",
  "rough",
  "shy",
  "smart",
  "social",
  "stubborn",
  "vocal",
] as const satisfies readonly PetTemperament[];

export const PERSON_STATUSES = [
  "pending",
  "active",
  "training",
  "inactive",
  "denied",
  "suspended",
  "blocked",
] as const satisfies readonly PersonStatus[];

export const PERSON_CREATE_STATUSES = [
  "pending",
  "active",
  "training",
  "inactive",
] as const satisfies readonly PersonCreateStatus[];

export const SURRENDER_URGENCIES = ["low", "normal", "high", "urgent"] as const;

export function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function choicesFrom<T extends string>(
  values: readonly T[],
): Choice<T>[] {
  return values.map((value) => ({ name: humanize(value), value }));
}
