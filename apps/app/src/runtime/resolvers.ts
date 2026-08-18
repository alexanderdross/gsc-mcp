/**
 * DB-gestützte Router-Abhängigkeiten ([docs/07], [docs/08]). Die Mandantenprüfung
 * (gehört die Property dem Nutzer?) und die Plan-Auflösung (aus der Subscription) — beide
 * als Funktionen, die der Router bzw. der Authentifikator injiziert bekommen.
 */

import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@gsc/db";
import type { Plan } from "@gsc/core";
import type { OwnershipCheck } from "../router.ts";
import type { PlanResolver } from "../oauth/authenticator.ts";

const { properties, subscriptions } = schema;
const PLAN_VALUES = new Set<Plan>(["free", "starter", "pro", "agency"]);

/** Prüft, ob die Property dem Nutzer gehört und nicht gelöscht ist. */
export function makeOwnershipCheck(db: Db): OwnershipCheck {
  return async (userId, propertyId) => {
    const [row] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.userId, userId), isNull(properties.deletedAt)))
      .limit(1);
    return row !== undefined;
  };
}

/** Löst den aktiven Plan eines Nutzers auf; ohne Subscription gilt „free". */
export function makePlanResolver(db: Db): PlanResolver {
  return async (userId) => {
    const [row] = await db
      .select({ plan: subscriptions.plan, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    if (!row || row.status !== "active") return "free";
    return PLAN_VALUES.has(row.plan as Plan) ? (row.plan as Plan) : "free";
  };
}
