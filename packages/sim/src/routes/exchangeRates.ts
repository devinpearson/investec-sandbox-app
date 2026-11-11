import express from 'express'
import { PrismaClient } from '@prisma/client'
import { formatErrorResponse, formatResponse } from '../app.js'
import { RATES_SOURCE, ratesInfo, refreshReferenceRates } from '../referenceRates.js'

const router = express.Router()
const prisma = new PrismaClient()

// Sandbox-only: the rates foreign card swipes are charged at. They're the
// ECB's reference rates from Frankfurter (src/referenceRates.ts), not
// something to edit. Investec's API has no equivalent.

function toResponse(rate: { currencyCode: string; zarPerUnit: { toNumber(): number }; updatedAt: Date }) {
  return {
    currencyCode: rate.currencyCode,
    zarPerUnit: rate.zarPerUnit.toNumber(),
    updatedAt: rate.updatedAt.toISOString(),
  }
}

async function listing() {
  const [rates, info] = await Promise.all([prisma.exchangeRate.findMany({ orderBy: { currencyCode: 'asc' } }), ratesInfo()])
  return { rates: rates.map(toResponse), source: { ...RATES_SOURCE, ...info } }
}

router.get('/', async (req, res) => formatResponse(await listing(), req, res))

// Fetch the latest rates now, instead of waiting for the next refresh.
router.post('/refresh', async (req, res) => {
  try {
    await refreshReferenceRates()
  } catch (error) {
    return formatErrorResponse(req, res, 502, `Couldn't fetch the reference rates from Frankfurter: ${(error as Error).message}`)
  }
  return formatResponse(await listing(), req, res)
})

export default router
