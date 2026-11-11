import request from 'supertest'
import { assert } from 'chai'
import { PrismaClient } from '@prisma/client'
import { app } from './app-server'
import { seedExchangeRates, seedRates } from '../prisma/exchange-rate'

// Foreign card swipes are charged in rand at the ECB's reference rates
// (src/referenceRates.ts; the tests use the seeded copy in
// prisma/exchange-rate.ts), and new cards can be issued against an account.
const ACCOUNT_ID = 'test-fx-account-001'
const ACCOUNTS = '/za/pb/v1/accounts'
const CARDS = '/za/v1/cards'

const swipe = (cardKey: string, currencyCode: string, centsAmount: number, merchantName = 'Shop') =>
  request(app).post(`${CARDS}/${cardKey}/code/execute-live`).send({
    currencyCode,
    centsAmount,
    merchantCode: '5411',
    merchantName,
    merchantCity: 'London',
    countryCode: 'GB',
  })

describe('New cards', () => {
  beforeEach(async () => {
    await request(app).delete(`${ACCOUNTS}/${ACCOUNT_ID}`)
    await request(app).post(ACCOUNTS).send({ accountId: ACCOUNT_ID, accountNumber: '70000000001' })
    await request(app).post(`${ACCOUNTS}/${ACCOUNT_ID}/topup`).send({ amount: 1000 })
  })

  afterAll(async () => {
    await request(app).delete(`${ACCOUNTS}/${ACCOUNT_ID}`)
  })

  it('issues a card on an account with defaults that swipe straight away', async () => {
    const created = await request(app).post(CARDS).send({ accountId: ACCOUNT_ID, isProgrammable: true })
    assert.equal(created.statusCode, 200)
    const card = created.body.data
    assert.equal(card.accountId, ACCOUNT_ID)
    assert.equal(card.accountNumber, '70000000001')
    assert.match(card.cardNumber, /^402167XXXXXX\d{4}$/)
    assert.equal(card.status, 'Active')

    const published = await request(app).get(`${CARDS}/${card.cardKey}/publishedcode`)
    assert.include(published.body.data.cardCode.code, 'const beforeTransaction')

    const approved = await swipe(card.cardKey, 'ZAR', 5000)
    assert.isTrue(approved.body.data.result)
    assert.equal(approved.body.data.transaction.accountId, ACCOUNT_ID)
  })

  it('refuses an account that does not exist', async () => {
    const response = await request(app).post(CARDS).send({ accountId: 'no-such-account' })
    assert.equal(response.statusCode, 422)
    assert.equal(response.body.errorMessage, 'No account with id no-such-account')
  })

  it('explains a duplicate card key', async () => {
    await request(app).post(CARDS).send({ cardKey: 'test-fx-dup', accountId: ACCOUNT_ID })
    const again = await request(app).post(CARDS).send({ cardKey: 'test-fx-dup', accountId: ACCOUNT_ID })
    assert.equal(again.statusCode, 409)
    assert.equal(again.body.errorMessage, 'A card with key test-fx-dup already exists')
  })
})

describe('Foreign currency swipes', () => {
  let cardKey: string

  beforeEach(async () => {
    await request(app).delete(`${ACCOUNTS}/${ACCOUNT_ID}`)
    await request(app).post(ACCOUNTS).send({ accountId: ACCOUNT_ID, accountNumber: '70000000001' })
    await request(app).post(`${ACCOUNTS}/${ACCOUNT_ID}/topup`).send({ amount: 1000 })
    cardKey = (await request(app).post(CARDS).send({ accountId: ACCOUNT_ID })).body.data.cardKey
  })

  afterAll(async () => {
    await request(app).delete(`${ACCOUNTS}/${ACCOUNT_ID}`)
  })

  const USD = seedRates.USD
  const rand = (cents: number) => Math.round(cents * USD) / 100

  it('lists the reference rates and where they come from', async () => {
    const response = await request(app).get('/exchange-rates')
    assert.equal(response.statusCode, 200)
    const { rates, source } = response.body.data
    const usd = rates.find((r: { currencyCode: string }) => r.currencyCode === 'USD')
    assert.equal(usd.zarPerUnit, USD)
    // Only the currencies Frankfurter publishes.
    assert.sameMembers(
      rates.map((r: { currencyCode: string }) => r.currencyCode),
      Object.keys(seedRates),
    )
    assert.equal(source.origin, 'seed')
    assert.equal(source.url, 'https://frankfurter.dev')
  })

  it('charges a foreign purchase in rand at the exchange rate', async () => {
    const response = await swipe(cardKey, 'USD', 1250, 'London Books')
    assert.isTrue(response.body.data.result)
    assert.deepEqual(response.body.data.exchange, {
      currencyCode: 'USD',
      amount: 12.5,
      zarPerUnit: USD,
      zarAmount: rand(1250),
    })
    const hold = response.body.data.transaction
    assert.equal(Number(hold.amount), rand(1250))
    assert.equal(hold.description, 'London Books (USD 12.50)')

    const balance = await request(app).get(`${ACCOUNTS}/${ACCOUNT_ID}/balance`)
    assert.closeTo(balance.body.data.availableBalance, 1000 - rand(1250), 0.001)
  })

  it('shows the card code the purchase in its own currency', async () => {
    await swipe(cardKey, 'usd', 1250)
    const executions = await request(app).get(`${CARDS}/${cardKey}/code/executions`)
    const before = executions.body.data.executions.find((e: { type: string }) => e.type === 'before_transaction')
    const authorization = JSON.parse(before.logs[0].content)
    assert.equal(authorization.currencyCode, 'usd')
    assert.equal(authorization.centsAmount, 1250)
  })

  it('checks the funds against the converted amount', async () => {
    // USD 70 is over R1,000, more than the R1,000 available.
    const response = await swipe(cardKey, 'USD', 7000)
    assert.isFalse(response.body.data.result)
    assert.equal(response.body.data.reason, 'insufficient_funds')
    assert.equal(response.body.data.exchange.zarAmount, rand(7000))
  })

  it('refuses a currency without a reference rate', async () => {
    for (const code of ['XYZ', 'MUR']) {
      const refused = await swipe(cardKey, code, 100)
      assert.equal(refused.statusCode, 422)
      assert.equal(
        refused.body.errorMessage,
        `No exchange rate for ${code}. Swipes can be in rand or a currency with an ECB reference rate (GET /exchange-rates).`,
      )
    }
  })

  it('has no way to edit rates', async () => {
    assert.equal((await request(app).put('/exchange-rates/USD').send({ zarPerUnit: 2 })).statusCode, 404)
    assert.equal((await request(app).delete('/exchange-rates/USD')).statusCode, 404)
  })

  it('leaves rand swipes unconverted', async () => {
    const response = await swipe(cardKey, 'ZAR', 1000)
    assert.isNull(response.body.data.exchange)
    assert.equal(response.body.data.transaction.description, 'Shop')
  })
})

describe('Reference rates from Frankfurter', () => {
  const realFetch = globalThis.fetch
  const prisma = new PrismaClient()

  afterEach(async () => {
    globalThis.fetch = realFetch
    // Back to the seeded copy for the other tests.
    await seedExchangeRates()
    await prisma.setting.deleteMany({ where: { name: 'referenceRates' } })
  })

  afterAll(() => prisma.$disconnect())

  it('stores the latest rates as rand per unit and drops the currencies it lacks', async () => {
    let asked = ''
    globalThis.fetch = (async (url: string) => {
      asked = String(url)
      return new Response(JSON.stringify({ amount: 1, base: 'ZAR', date: '2026-01-02', rates: { USD: 0.05, EUR: 0.04 } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const response = await request(app).post('/exchange-rates/refresh')
    assert.equal(response.statusCode, 200)
    assert.equal(asked, 'https://api.frankfurter.dev/v1/latest?base=ZAR')
    const { rates, source } = response.body.data
    assert.deepEqual(
      rates.map((r: { currencyCode: string; zarPerUnit: number }) => [r.currencyCode, r.zarPerUnit]),
      [
        ['EUR', 25],
        ['USD', 20],
      ],
    )
    assert.equal(source.origin, 'frankfurter')
    assert.equal(source.date, '2026-01-02')
    assert.isString(source.fetchedAt)
  })

  it('keeps the stored rates when Frankfurter can’t be reached', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as typeof fetch

    const response = await request(app).post('/exchange-rates/refresh')
    assert.equal(response.statusCode, 502)
    assert.include(response.body.errorMessage, 'offline')
    const rates = (await request(app).get('/exchange-rates')).body.data.rates
    assert.equal(rates.length, Object.keys(seedRates).length)
  })

  it('refuses an answer that isn’t rates for the rand', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ base: 'EUR', date: '2026-01-02', rates: { USD: 1.1 } }))) as typeof fetch
    assert.equal((await request(app).post('/exchange-rates/refresh')).statusCode, 502)
  })
})
