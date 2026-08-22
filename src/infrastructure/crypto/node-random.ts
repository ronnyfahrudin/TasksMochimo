import { randomBytes, randomInt } from "node:crypto";
import type { RandomSource } from "@/domain/shared/ports";

/** CSPRNG-backed randomness. `randomInt` is uniform and bounded. */
export const nodeRandom: RandomSource = {
  token: (bytes: number) => randomBytes(bytes).toString("hex"),
  int: (min: number, max: number) => randomInt(min, max + 1),
};
