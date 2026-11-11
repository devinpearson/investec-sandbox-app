import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Rand per unit, for the currencies Frankfurter publishes (the European
// Central Bank's reference rates; see src/referenceRates.ts). These are its
// rates on 2026-11-09, rounded: the sandbox starts with them and uses them
// until it fetches the day's rates, or if it's offline.
export const SEED_RATES_DATE = '2026-11-09'
export const seedRates: Record<string, number> = {
  AUD: 11.34,
  BRL: 2.982,
  CAD: 11.66,
  CHF: 20.09,
  CNY: 2.465,
  CZK: 0.7556,
  DKK: 2.463,
  EUR: 18.41,
  GBP: 22.07,
  HKD: 2.098,
  HUF: 0.05072,
  IDR: 0.0009099,
  ILS: 5.188,
  INR: 0.1751,
  ISK: 0.1346,
  JPY: 0.1041,
  KRW: 0.01221,
  MXN: 0.8837,
  MYR: 4.052,
  NOK: 1.748,
  NZD: 9.233,
  PHP: 0.2604,
  PLN: 4.199,
  RON: 3.446,
  SEK: 1.674,
  SGD: 12.85,
  THB: 0.4911,
  TRY: 0.3281,
  USD: 16.45,
}

export async function seedExchangeRates() {
  for (const [currencyCode, zarPerUnit] of Object.entries(seedRates)) {
    await prisma.exchangeRate.upsert({
      where: { currencyCode },
      update: { zarPerUnit },
      create: { currencyCode, zarPerUnit },
    })
  }
  // Only these currencies: drop any the reference rates don't cover.
  await prisma.exchangeRate.deleteMany({ where: { currencyCode: { notIn: Object.keys(seedRates) } } })
  console.log(`Seeded ${Object.keys(seedRates).length} exchange rates`)
}
