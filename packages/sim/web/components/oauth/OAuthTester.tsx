'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRight, Check, Copy, KeyRound, Lock, LogIn, RefreshCw, Send, X } from 'lucide-react';
import { Button, Field, Input, Panel } from '@/components/ui';
import { useAction } from '@/components/ToastProvider';
import { useSettings } from '@/hooks/useSandbox';
import { saveSettings } from '@/lib/api/sandbox';
import { apiUrl, getApiBaseUrl } from '@/lib/api/common';
import {
  authorizeUrl,
  callWithToken,
  exchangeCode,
  loadPendingFlow,
  OAUTH_SCOPES,
  parseCallback,
  randomState,
  refreshAccessToken,
  savePendingFlow,
  type CallbackResult,
  type TokenResponse,
  type TryResult,
} from '@/lib/oauth';

const TRY_PATHS = ['/za/pb/v1/accounts', '/za/pb/v1/profiles', '/za/pb/v1/accounts/beneficiaries', '/za/v1/cards'];

function Code({ children }: { children: string }) {
  return (
    <code className="block break-all rounded-md bg-gray-100 px-2.5 py-1.5 font-mono text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
      {children}
    </code>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-3">
      <dt className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</dt>
      <dd className="min-w-0 text-sm text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{children}</p>;
}

// A request to copy into a terminal or your own code. The client secret is
// left as a placeholder so it isn't shown on the page.
function Request({ label, command }: { label: string; command: string }) {
  const run = useAction();
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Code>{command}</Code>
        </div>
        <Button
          variant="secondary"
          aria-label={`Copy: ${label}`}
          onClick={() => run(() => navigator.clipboard.writeText(command), 'Request copied')}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

const SECRET_PLACEHOLDER = '<client secret>';

function tokenCurl(clientId: string | undefined, fields: string[]) {
  const data = fields.map(field => `--data-urlencode "${field}"`).join(' ');
  return `curl -X POST "${apiUrl('/identity/v2/oauth2/token')}" -u "${clientId || '<client id>'}:${SECRET_PLACEHOLDER}" ${data}`;
}

function IntroPanel() {
  const { data: settings } = useSettings();
  const settingsLink = (
    <Link href="/settings" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
      Settings
    </Link>
  );
  return (
    <Panel
      id="oauth-intro"
      title="How the flow works"
      description="New to this? The 3-legged flow is how a bank customer lets your app reach their accounts without giving it their password."
    >
      <dl className="space-y-3">
        <Row label="Your app">
          This page stands in for it. Every step below shows the request your own app will make.
        </Row>
        <Row label="The bank">
          The sandbox API at <span className="font-mono text-xs">{getApiBaseUrl()}</span>, plus its sign-in and consent
          pages.
        </Row>
        <Row label="The user">You, signing in as the sandbox customer and choosing what to share.</Row>
        <Row label="Your credentials">
          Your app has a client ID
          {settings?.client_id ? (
            <>
              {' '}
              (<span className="font-mono text-xs">{settings.client_id}</span>)
            </>
          ) : null}{' '}
          and a client secret, both in {settingsLink}. This page reads them from there. The client ID goes in the
          authorize URL; the secret is only ever sent from your server, when it swaps the code for tokens.
        </Row>
      </dl>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
        <li>Your app sends the user&apos;s browser to the bank with the scopes it wants.</li>
        <li>The user signs in at the bank and picks the accounts to share.</li>
        <li>The bank sends the browser back to your redirect URI with a one-time code.</li>
        <li>Your server swaps the code for an access token and a refresh token.</li>
        <li>Your app calls the API with the access token, and refreshes it when it expires.</li>
      </ol>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        The sandbox is looser than a real bank: it accepts any redirect URI, has one fixed user, and doesn&apos;t ask
        for an API key when exchanging the code. Check Investec&apos;s documentation for what production requires.
      </p>
    </Panel>
  );
}

function StartPanel() {
  const { data: settings, mutate } = useSettings();
  const run = useAction();
  const [scopes, setScopes] = useState<string[]>(OAUTH_SCOPES.map(s => s.scope));
  const [redirectUri, setRedirectUri] = useState('');
  const [state, setState] = useState('');

  // Browser-only values, so they're set after the first render. Back from a
  // flow, keep its scopes and redirect URI for the next one.
  useEffect(() => {
    const previous = loadPendingFlow();
    if (previous) setScopes(previous.scopes);
    setRedirectUri(previous?.redirectUri || `${window.location.origin}/oauth`);
    setState(randomState());
  }, []);

  const url = settings && redirectUri && state ? authorizeUrl({ clientId: settings.client_id, redirectUri, scopes, state }) : '';
  const comesBackHere = typeof window !== 'undefined' && redirectUri === `${window.location.origin}/oauth`;

  function toggle(scope: string) {
    setScopes(current => (current.includes(scope) ? current.filter(s => s !== scope) : [...current, scope]));
  }

  function start() {
    savePendingFlow({ state, redirectUri, scopes });
    window.location.assign(url);
  }

  return (
    <Panel
      id="oauth-start"
      title="1. Start a sign-in"
      description="Act as a third-party app: send the user to the bank's sign-in and consent pages with the scopes the app wants."
    >
      {settings && !settings.auth && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="flex-1">
            Auth is off, so the API doesn&apos;t check tokens: the flow works, but scopes and chosen accounts
            aren&apos;t enforced.
          </p>
          <Button
            variant="secondary"
            onClick={async () => {
              await run(() => saveSettings({ ...settings, auth: true }), 'Auth turned on');
              await mutate();
            }}
          >
            Turn on auth
          </Button>
        </div>
      )}

      <fieldset>
        <legend className="text-xs font-medium text-gray-600 dark:text-gray-300">Scopes</legend>
        <Hint>
          What your app is asking to do. Ask only for what you need: the user sees this list before approving, and
          the token is refused (403) on anything outside it. Unticking everything asks for every scope.
        </Hint>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OAUTH_SCOPES.map(({ scope, label }) => (
            <label key={scope} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
                checked={scopes.includes(scope)}
                onChange={() => toggle(scope)}
              />
              <span>
                <span className="font-mono text-xs">{scope}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Redirect URI" htmlFor="oauth-redirect">
          <Input id="oauth-redirect" value={redirectUri} onChange={e => setRedirectUri(e.target.value)} />
          <Hint>
            Where the bank sends the user afterwards, with the code. Leave it as this page to finish here, or put in
            your own app&apos;s callback address to test your app.
          </Hint>
        </Field>
        <Field label="State" htmlFor="oauth-state">
          <div className="flex gap-2">
            <Input id="oauth-state" value={state} onChange={e => setState(e.target.value)} />
            <Button variant="secondary" aria-label="New state" onClick={() => setState(randomState())}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Hint>
            A random value your app makes up and remembers. The bank sends it back unchanged, so your app can tell
            the redirect answers a sign-in it started.
          </Hint>
        </Field>
      </div>
      {!comesBackHere && redirectUri && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          The code goes to your redirect URI, so your app does the exchange. Keep this page&apos;s address to finish the
          flow here.
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Authorize URL</p>
        <Hint>The link your app sends the user&apos;s browser to. Start sign-in below opens exactly this.</Hint>
        <div className="mt-1 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Code>{url || '…'}</Code>
          </div>
          <Button
            variant="secondary"
            aria-label="Copy the authorize URL"
            disabled={!url}
            onClick={() => run(() => navigator.clipboard.writeText(url), 'Authorize URL copied')}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <Button disabled={!url || !redirectUri} onClick={start}>
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Start sign-in
        </Button>
        <Hint>
          Next you&apos;ll see the bank&apos;s sign-in page (the sandbox user is filled in), then the consent page.
          Tick the accounts to share, or none for all of them, and choose Authorize or Decline.
        </Hint>
      </div>
    </Panel>
  );
}

function CallbackPanel({
  callback,
  redirectUri,
  onTokens,
}: {
  callback: CallbackResult;
  redirectUri: string;
  onTokens: (tokens: TokenResponse) => void;
}) {
  const { data: settings } = useSettings();
  const run = useAction();
  const [exchanged, setExchanged] = useState(false);
  const approved = callback.status === 'SUCCESS';

  return (
    <Panel
      id="oauth-callback"
      title="2. Back from the bank"
      description="What the sandbox added to the redirect URI. Your app reads these from the address of its callback page."
    >
      <dl className="space-y-3">
        <Row label="Status">
          <span
            className={`inline-flex items-center gap-1 font-semibold ${approved ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
          >
            {approved ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
            {callback.status}
          </span>
        </Row>
        <Row label="State">
          {callback.stateMatches ? (
            <span className="text-emerald-700 dark:text-emerald-400">Matches the request ({callback.state})</span>
          ) : callback.state === null ? (
            <span className="text-amber-700 dark:text-amber-400">
              None sent, so the flow was started elsewhere (Postman, say). You can still exchange the code; a real app
              should send a state and check it.
            </span>
          ) : (
            <span className="text-red-700 dark:text-red-400">
              Doesn&apos;t match the request this page started ({callback.state ?? 'none'}). A real app should stop here.
            </span>
          )}
        </Row>
        <Row label="Code">
          <Code>{callback.code}</Code>
        </Row>
      </dl>
      {approved ? (
        <div className="mt-4">
          <Button
            disabled={!settings || exchanged}
            onClick={async () => {
              if (!settings) return;
              const tokens = await run(
                () => exchangeCode(settings, callback.code, redirectUri),
                'Code exchanged for tokens',
              );
              if (tokens) {
                setExchanged(true);
                onTokens(tokens);
              }
            }}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Exchange code for tokens
          </Button>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            POST /identity/v2/oauth2/token with grant_type=authorization_code, the code and the redirect URI, signed
            in with HTTP Basic auth (client ID as the username, client secret as the password). Codes work once and
            expire{settings ? ` after ${settings.token_expiry} seconds` : ''}, so do this from your server as soon as
            the redirect arrives.
          </p>
          <Request
            label="The same request with curl"
            command={tokenCurl(settings?.client_id, [
              'grant_type=authorization_code',
              `code=${callback.code}`,
              `redirect_uri=${redirectUri}`,
            ])}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          The user declined, so the code can&apos;t be exchanged.
        </p>
      )}
    </Panel>
  );
}

function TokensPanel({ tokens, onTokens }: { tokens: TokenResponse; onTokens: (tokens: TokenResponse) => void }) {
  const { data: settings } = useSettings();
  const run = useAction();
  return (
    <Panel
      id="oauth-tokens"
      title="3. Tokens"
      actions={
        tokens.refresh_token && (
          <Button
            variant="secondary"
            disabled={!settings}
            onClick={async () => {
              if (!settings || !tokens.refresh_token) return;
              const fresh = await run(() => refreshAccessToken(settings, tokens.refresh_token!), 'Tokens refreshed');
              if (fresh) onTokens(fresh);
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        )
      }
    >
      <dl className="space-y-3">
        <Row label="Access token">
          <Code>{tokens.access_token}</Code>
        </Row>
        {tokens.refresh_token && (
          <Row label="Refresh token">
            <Code>{tokens.refresh_token}</Code>
          </Row>
        )}
        <Row label="Scope">
          <span className="font-mono text-xs">{tokens.scope}</span>
        </Row>
        <Row label="Expires in">{tokens.expires_in} seconds</Row>
      </dl>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        The access token goes on every API call and stops working when it expires. The refresh token gets a new pair
        without the user signing in again. Refresh tokens rotate: each works once, so store the new one every time.
        Tokens are only kept on this page, and reloading clears them.
      </p>
      {tokens.refresh_token && (
        <Request
          label="Get a new pair with curl"
          command={tokenCurl(settings?.client_id, ['grant_type=refresh_token', `refresh_token=${tokens.refresh_token}`])}
        />
      )}
    </Panel>
  );
}

function TryPanel({ accessToken }: { accessToken: string }) {
  const [path, setPath] = useState(TRY_PATHS[0]);
  const [result, setResult] = useState<TryResult | null>(null);
  const [sending, setSending] = useState(false);
  const run = useAction();

  async function send() {
    setSending(true);
    const value = await run(() => callWithToken(path, accessToken), r => `${r.status} from ${path}`);
    if (value) setResult(value);
    setSending(false);
  }

  return (
    <Panel
      id="oauth-try"
      title="4. Call the API with the token"
      description="Send the access token as a Bearer token. With auth on, only the approved accounts come back, and a path outside the approved scopes answers 403."
    >
      <div className="flex flex-wrap gap-2">
        {TRY_PATHS.map(p => (
          <Button key={p} variant={p === path ? 'dark' : 'secondary'} onClick={() => setPath(p)}>
            {p}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <label htmlFor="oauth-path" className="sr-only">
            Path
          </label>
          <Input id="oauth-path" value={path} onChange={e => setPath(e.target.value)} />
        </div>
        <Button disabled={sending || !path.startsWith('/')} onClick={send}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </Button>
      </div>
      {path.startsWith('/') && (
        <Request
          label="The same call with curl"
          command={`curl "${apiUrl(path)}" -H "Authorization: Bearer ${accessToken}"`}
        />
      )}
      {result && (
        <div className="mt-4" aria-live="polite">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Status {result.status}
          </p>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-gray-100 p-3 font-mono text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
            {result.body || '(empty body)'}
          </pre>
        </div>
      )}
    </Panel>
  );
}

// A step that hasn't happened yet: what it will show, and what unlocks it,
// so the whole flow is visible before you start.
function UpcomingStep({ title, children, unlockedBy }: { title: string; children: React.ReactNode; unlockedBy: string }) {
  return (
    <section
      aria-label={`${title} (not yet)`}
      className="rounded-lg border-2 border-dashed border-gray-300 px-4 py-4 sm:px-6 dark:border-gray-600"
    >
      <h2 className="text-lg font-semibold text-gray-400 dark:text-gray-500">{title}</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{children}</p>
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {unlockedBy}
      </p>
    </section>
  );
}

// Bring a step that just appeared into view, after the page has settled.
function revealStep(id: string) {
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}

export default function OAuthTester() {
  const params = useSearchParams();
  const router = useRouter();
  const [callback, setCallback] = useState<CallbackResult | null>(null);
  const [redirectUri, setRedirectUri] = useState('');
  const [tokens, setTokens] = useState<TokenResponse | null>(null);

  // Read the redirect back once; the URL is cleaned up after the exchange.
  useEffect(() => {
    const pending = loadPendingFlow();
    const result = parseCallback(new URLSearchParams(params.toString()), pending);
    if (result) {
      setCallback(result);
      // The code came back to this page, so this page is the redirect URI,
      // unless it's the flow this page started (keep that exact value).
      const here = `${window.location.origin}${window.location.pathname}`;
      setRedirectUri(result.stateMatches && pending ? pending.redirectUri : here);
      // Back from the bank: step 2 is below the fold, so go to it.
      revealStep('oauth-callback');
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">OAuth tester</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Go through the 3-legged (authorization code) flow end to end: sign in, consent, exchange the code, refresh,
          and call the API.
        </p>
      </div>
      <IntroPanel />
      <StartPanel />
      {callback && (
        <CallbackPanel
          callback={callback}
          redirectUri={redirectUri}
          onTokens={fresh => {
            const first = !tokens;
            setTokens(fresh);
            router.replace('/oauth', { scroll: false });
            if (first) revealStep('oauth-tokens');
          }}
        />
      )}
      {!callback && (
        <>
          <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            Start a sign-in above: you sign in and approve at the bank, then come back here for the next steps.
          </p>
          <UpcomingStep title="2. Back from the bank" unlockedBy="After you sign in and approve (or decline) at the bank">
            The bank sends you back to this page with an authorization code. You&apos;ll see what came back, check the
            state, and exchange the code for tokens.
          </UpcomingStep>
        </>
      )}
      {tokens ? (
        <>
          <TokensPanel tokens={tokens} onTokens={setTokens} />
          <TryPanel accessToken={tokens.access_token} />
        </>
      ) : (
        <>
          <UpcomingStep title="3. Tokens" unlockedBy="After you exchange the code in step 2">
            The access token your app calls the API with, the refresh token, and how long they last. You can refresh
            them here too.
          </UpcomingStep>
          <UpcomingStep title="4. Call the API with the token" unlockedBy="After you have tokens in step 3">
            Send a request with the access token as a Bearer token, and see which accounts the approval covers.
          </UpcomingStep>
        </>
      )}
    </div>
  );
}
