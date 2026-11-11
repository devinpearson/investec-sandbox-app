// Declarations for main.js, so the editor completes and documents what card
// code can use: the authorization passed to beforeTransaction, process.env
// (from env.json), moment and fetch. Mirrors programmable-card-code-emulator.
export const cardCodeTypes = `
/** The merchant category, looked up from its code (MCC). */
interface MerchantCategory {
  /** The four-digit merchant category code, e.g. "5542". */
  code: string;
  /** e.g. "automated_fuel_dispensers" */
  key: string;
  /** e.g. "Automated Fuel Dispensers" */
  name: string;
}

interface Country {
  /** ISO 3166 alpha-2, e.g. "ZA". */
  code: string;
  /** ISO 3166 alpha-3, e.g. "ZAF". */
  alpha3: string;
  name: string;
}

interface Merchant {
  category: MerchantCategory;
  name: string;
  city: string;
  country: Country;
}

/** A card authorization: the purchase the card is being asked to approve. */
interface Authorization {
  accountNumber: string;
  /** ISO 8601 time of the purchase. */
  dateTime: string;
  /** The amount in cents: R100.00 is 10000. */
  centsAmount: number;
  /** Lower-case ISO 4217 currency code, e.g. "zar". */
  currencyCode: string;
  type: "card";
  reference: string;
  card: { id: string };
  merchant: Merchant;
}

/** A completed (approved) or declined transaction. */
interface CardTransaction extends Authorization {}

/** The card's environment variables: the values in env.json. */
declare const process: { env: Record<string, string | undefined> };

interface CardFetchResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  json(): Promise<any>;
  text(): Promise<string>;
}
/**
 * Makes an HTTP request from the card code (e.g. a webhook or an API).
 * The body comes back as text; binary bodies aren't kept.
 */
declare function fetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<CardFetchResponse>;

/** moment.js, built into the card's sandbox. */
declare const moment: {
  (input?: string | number | Date, format?: string): any;
  utc(input?: string | number | Date, format?: string): any;
  [key: string]: any;
};
`;
