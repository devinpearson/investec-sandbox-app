// The two files the code editor runs: main.js (the card code) and env.json
// (its environment variables).

export const BLANK_MAIN = `/**
 * Runs before the purchase is approved. Return false to decline it;
 * anything else (including nothing) approves it.
 * @param {Authorization} authorization
 */
const beforeTransaction = async (authorization) => {
  console.log(authorization.merchant.name, authorization.centsAmount);
  return true;
};

/**
 * Runs after an approved purchase.
 * @param {CardTransaction} transaction
 */
const afterTransaction = async (transaction) => {
  console.log("Approved", transaction.merchant.name);
};

/**
 * Runs after a declined purchase.
 * @param {CardTransaction} transaction
 */
const afterDecline = async (transaction) => {
  console.log("Declined", transaction.merchant.name);
};
`;

export type ParsedEnv = { values: Record<string, string> } | { error: string };

/**
 * env.json as the simulator's environmentVariables. Card environment values
 * are text, so numbers and booleans are sent as text too.
 */
export function parseEnv(text: string): ParsedEnv {
  if (!text.trim()) return { values: {} };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `not valid JSON (${(e as Error).message})` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: 'should be an object, like { "NAME": "value" }' };
  }
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object") {
      return { error: `${name} should be text, not an object or list` };
    }
    values[name] = value === null ? "" : String(value);
  }
  return { values };
}
