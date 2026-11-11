import { PrismaClient } from '@prisma/client'
import { SEED_RATES_DATE, seedRates } from '../prisma/exchange-rate.js'

// The rates foreign card swipes are charged at: the European Central Bank's
// daily reference rates, from Frankfurter (https://frankfurter.dev). Fetched
// when the API starts and every few hours; the ECB publishes once a working
// day. Until a fetch succeeds (or when offline) the seeded copy is used.
// Only the currencies Frankfurter has are kept.

const prisma = new PrismaClient()

const SOURCE_URL = process.env.REFERENCE_RATES_URL || 'https://api.frankfurter.dev/v1/latest?base=ZAR'
const REFRESH_MS = 6 * 60 * 60 * 1000
const SETTING = 'referenceRates'

export const RATES_SOURCE = {
  name: 'European Central Bank reference rates, via Frankfurter',
  url: 'https://frankfurter.dev',
}

export interface RatesInfo {
  // 'frankfurter' once fetched; 'seed' for the copy the sandbox starts with.
  origin: 'frankfurter' | 'seed'
  // The day the rates are for.
  date: string
  // When they were last fetched (null for the seeded copy).
  fetchedAt: string | null
}

// REFERENCE_RATES=off keeps the seeded rates (e.g. for tests).
const referenceRatesEnabled = () => process.env.REFERENCE_RATES !== 'off'

export async function ratesInfo(): Promise<RatesInfo> {
  const row = await prisma.setting.findUnique({ where: { name: SETTING } })
  if (row) {
    try {
      const saved = JSON.parse(row.value) as RatesInfo
      if (saved.date) return saved
    } catch {
      // Unreadable: treat as never fetched.
    }
  }
  return { origin: 'seed', date: SEED_RATES_DATE, fetchedAt: null }
}

interface FrankfurterLatest {
  base: string
  date: string
  rates: Record<string, number>
}

function isLatest(value: unknown): value is FrankfurterLatest {
  const v = value as FrankfurterLatest
  return Boolean(v && v.base === 'ZAR' && typeof v.date === 'string' && v.rates && typeof v.rates === 'object')
}

// Fetch the latest rates and store them as rand per unit. Throws if
// Frankfurter can't be reached or answers with something unexpected; the
// rates already stored stay as they are.
export async function refreshReferenceRates(): Promise<RatesInfo & { currencies: number }> {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Frankfurter answered ${response.status}`)
  const body: unknown = await response.json()
  if (!isLatest(body)) throw new Error('Frankfurter sent rates in an unexpected shape')

  // Frankfurter gives units per rand; the sandbox stores rand per unit.
  const rates = Object.entries(body.rates)
    .filter(([code, perRand]) => /^[A-Z]{3}$/.test(code) && code !== 'ZAR' && Number.isFinite(perRand) && perRand > 0)
    .map(([currencyCode, perRand]) => ({ currencyCode, zarPerUnit: Number((1 / perRand).toPrecision(8)) }))
  if (!rates.length) throw new Error('Frankfurter sent no rates')

  const info: RatesInfo = { origin: 'frankfurter', date: body.date, fetchedAt: new Date().toISOString() }
  const value = JSON.stringify(info)
  await prisma.$transaction([
    ...rates.map(rate =>
      prisma.exchangeRate.upsert({ where: { currencyCode: rate.currencyCode }, update: rate, create: rate }),
    ),
    // Currencies it doesn't publish are dropped.
    prisma.exchangeRate.deleteMany({ where: { currencyCode: { notIn: rates.map(r => r.currencyCode) } } }),
    prisma.setting.upsert({ where: { name: SETTING }, update: { value }, create: { name: SETTING, value } }),
  ])
  return { ...info, currencies: rates.length }
}

// A database from before the rates came from Frankfurter can hold currencies
// it doesn't publish; until the first fetch replaces them, drop those.
async function dropUnpublishedCurrencies() {
  if ((await ratesInfo()).origin !== 'seed') return
  await prisma.exchangeRate.deleteMany({ where: { currencyCode: { notIn: Object.keys(seedRates) } } })
}

// At startup and every few hours. Failures are logged and retried next time.
export function startReferenceRates(log: (message: string) => void = console.log) {
  void dropUnpublishedCurrencies().catch(() => {})
  if (!referenceRatesEnabled()) {
    log('Reference rates: fetching is off (REFERENCE_RATES=off); using the stored rates')
    return
  }
  const refresh = () =>
    refreshReferenceRates().then(
      info => log(`Reference rates: ${info.currencies} currencies for ${info.date}, from Frankfurter`),
      error => log(`Reference rates: couldn't fetch from Frankfurter (${(error as Error).message}); using the stored rates`),
    )
  void refresh()
  setInterval(refresh, REFRESH_MS).unref()
}
