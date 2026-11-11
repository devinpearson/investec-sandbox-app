// Quick start: the first three calls a new integration makes (a token, the
// accounts, an account's transactions), written out in a few languages with
// this sandbox's address and credentials filled in. The requests are the
// ones Investec's own API takes, so the code works against the bank with
// only the address and the credentials changed.

const LANGUAGES = [
  { id: 'curl', label: 'curl', file: null, run: 'Paste into a terminal.' },
  { id: 'node', label: 'Node.js', file: 'quickstart.mjs', run: 'Save as quickstart.mjs and run: node quickstart.mjs (Node 18 or newer).' },
  { id: 'python', label: 'Python', file: 'quickstart.py', run: 'Save as quickstart.py and run: python3 quickstart.py (needs: pip install requests).' },
  { id: 'csharp', label: 'C#', file: 'Program.cs', run: 'In a new console project (dotnet new console), replace Program.cs and run: dotnet run.' },
]

const STEPS = [
  {
    id: 'token',
    title: 'Get an access token',
    text: 'Exchange the client ID, client secret and API key for a token. It goes in the Authorization header of every other call.',
    request: 'POST /identity/v2/oauth2/token',
    // What a call from your own code looks like when it has worked.
    matches: r => r.method === 'POST' && r.path.split('?')[0] === '/identity/v2/oauth2/token',
  },
  {
    id: 'accounts',
    title: 'List the accounts',
    text: 'The accounts the credentials can see. Each has an accountId, which the other account calls take.',
    request: 'GET /za/pb/v1/accounts',
    matches: r => r.method === 'GET' && r.path.split('?')[0].replace(/\/$/, '') === '/za/pb/v1/accounts',
  },
  {
    id: 'transactions',
    title: 'Read an account’s transactions',
    text: 'The history of one account, newest first. Swipe a card or make a transfer in the app and call it again to see the new entry.',
    request: 'GET /za/pb/v1/accounts/{accountId}/transactions',
    matches: r => r.method === 'GET' && /^\/za\/pb\/v1\/accounts\/[^/]+\/transactions$/.test(r.path.split('?')[0]),
  },
]

// v: { api, id, secret, key, token, accountId }. `token` and `accountId` are
// only used by curl, which has no variables to carry them between steps.
const SNIPPETS = {
  curl: {
    token: v => `curl -X POST '${v.api}/identity/v2/oauth2/token' \\
  -u '${v.id}:${v.secret}' \\
  -H 'x-api-key: ${v.key}' \\
  -d 'grant_type=client_credentials'`,
    accounts: v => `curl '${v.api}/za/pb/v1/accounts' \\
  -H 'Authorization: Bearer ${v.token}'`,
    transactions: v => `curl '${v.api}/za/pb/v1/accounts/${v.accountId}/transactions' \\
  -H 'Authorization: Bearer ${v.token}'`,
  },

  node: {
    token: v => `const api = '${v.api}'

const tokenResponse = await fetch(\`\${api}/identity/v2/oauth2/token\`, {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from('${v.id}:${v.secret}').toString('base64'),
    'x-api-key': '${v.key}',
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
})
const { access_token } = await tokenResponse.json()
console.log('Token:', access_token)`,
    accounts: () => `const headers = { Authorization: \`Bearer \${access_token}\` }

const accountsResponse = await fetch(\`\${api}/za/pb/v1/accounts\`, { headers })
const { accounts } = (await accountsResponse.json()).data
console.log(accounts)`,
    transactions: () => `const { accountId } = accounts[0]

const transactionsResponse = await fetch(\`\${api}/za/pb/v1/accounts/\${accountId}/transactions\`, { headers })
const { transactions } = (await transactionsResponse.json()).data
console.log(transactions)`,
  },

  python: {
    token: v => `import requests

api = '${v.api}'

token_response = requests.post(
    f'{api}/identity/v2/oauth2/token',
    auth=('${v.id}', '${v.secret}'),
    headers={'x-api-key': '${v.key}'},
    data={'grant_type': 'client_credentials'},
)
access_token = token_response.json()['access_token']
print('Token:', access_token)`,
    accounts: () => `headers = {'Authorization': f'Bearer {access_token}'}

accounts = requests.get(f'{api}/za/pb/v1/accounts', headers=headers).json()['data']['accounts']
print(accounts)`,
    transactions: () => `account_id = accounts[0]['accountId']

transactions = requests.get(
    f'{api}/za/pb/v1/accounts/{account_id}/transactions', headers=headers
).json()['data']['transactions']
print(transactions)`,
  },

  csharp: {
    token: v => `using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var api = "${v.api}";
var http = new HttpClient();

var tokenRequest = new HttpRequestMessage(HttpMethod.Post, $"{api}/identity/v2/oauth2/token")
{
    Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "client_credentials" }),
};
tokenRequest.Headers.Authorization = new AuthenticationHeaderValue(
    "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes("${v.id}:${v.secret}")));
tokenRequest.Headers.Add("x-api-key", "${v.key}");

var tokenResponse = await http.SendAsync(tokenRequest);
var accessToken = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync())
    .RootElement.GetProperty("access_token").GetString();
Console.WriteLine($"Token: {accessToken}");`,
    accounts: () => `http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

var accounts = JsonDocument.Parse(await http.GetStringAsync($"{api}/za/pb/v1/accounts"))
    .RootElement.GetProperty("data").GetProperty("accounts");
Console.WriteLine(accounts);`,
    transactions: () => `var accountId = accounts[0].GetProperty("accountId").GetString();

var transactions = JsonDocument.Parse(await http.GetStringAsync($"{api}/za/pb/v1/accounts/{accountId}/transactions"))
    .RootElement.GetProperty("data").GetProperty("transactions");
Console.WriteLine(transactions);`,
  },
}

const snippet = (language, step, values) => SNIPPETS[language]?.[step]?.(values) ?? ''

// Every step of a language as one file (curl: the three commands).
const script = (language, values) => STEPS.map(step => snippet(language, step.id, values)).join('\n\n')

module.exports = { LANGUAGES, STEPS, snippet, script }
