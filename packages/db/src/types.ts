import { customType } from "drizzle-orm/pg-core";

/**
 * PostgreSQL `bytea`. Nicht in allen drizzle-Versionen als benannter Typ
 * exportiert, deshalb hier explizit — u. a. für den verschlüsselten Refresh-Token.
 */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
