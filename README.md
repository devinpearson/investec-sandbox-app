# Investec Sandbox

A local copy of Investec's programmable banking APIs that you can run on your Mac or Windows PC. Build and test against realistic accounts, transactions, cards and payments without touching a real bank account, and write card code with a visual or code editor.

Everything runs on your computer. There's nothing to sign up for and nothing else to install.

> A community project. It is not made, endorsed or supported by Investec.

## Download
Get the latest version from the [Releases page](https://github.com/devinpearson/investec-sandbox-app/releases/latest):

| Your computer | Download |
|---|---|
| Mac with Apple silicon (M1 or newer) | `Investec-Sandbox-<version>-arm64.dmg` |
| Mac with an Intel processor | `Investec-Sandbox-<version>-x64.dmg` |
| Windows 10 or 11 (64-bit) | `Investec-Sandbox-Setup-<version>-x64.exe` |

Not sure which Mac you have? Choose **Apple menu → About This Mac**. Apple silicon Macs show **Chip: Apple M…**, and Intel Macs show **Processor: … Intel**.

You need macOS 12 (Monterey) or later, or Windows 10 or later.

## Install
**Mac:**
1. Open the `.dmg` and drag **Investec Sandbox** to **Applications**.
2. Open it from Applications. If macOS says it can't check the app for malicious software, right-click the app, choose **Open**, then **Open** again. On recent macOS versions, open it once, then go to **System Settings → Privacy & Security** and choose **Open Anyway**. You only need to do this the first time.

**Windows:**
1. Run the installer. If Windows SmartScreen says it protected your PC, choose **More info → Run anyway**.
2. Pick where to install it. It installs for your user only, so it doesn't need admin rights.
3. Open **Investec Sandbox** from the Start menu.

## Getting started
The first time it opens, the app shows a welcome sheet with your sandbox's API address, client ID, client secret and API key, each with a Copy button. Use these wherever your code or Postman would use Investec's:

- **API address:** `http://localhost:3000`, unless that port was taken (the app picks the next free one and shows you).
- **Postman:** the welcome sheet links to the Investec Postman collection. Point its base URL at the sandbox's address.
- **Quick start** (in the sidebar, under Develop) walks you through your first three calls: get a token, list the accounts, list an account's transactions. It shows each in curl, Node.js, Python and C#, with your sandbox's details filled in. Each step is ticked once that call arrives from your own code.

The sandbox comes loaded with starter data: a profile, accounts, cards and a history of transactions. **Data & scenarios** loads other setups, or resets everything.

## What you can do
**Banking:** see and change the sandbox's data as your code would.
- **Accounts:** balances, top-ups and transfers between accounts.
- **Transactions:** filter by account, date and type.
- **Cards:** issue cards and swipe them at a point of sale, including pending holds and foreign currency. Foreign swipes are charged at the European Central Bank's reference rates, refreshed every six hours.
- **Beneficiaries:** add beneficiaries and pay them.

**Simulate:** test the cases that are hard to make happen on a real account.
- **Clock & schedules:** move the sandbox's date forward and run recurring transactions, like debit orders and salaries.
- **Faults:** make the API return random errors, time out or slow down, to test how your app copes. Only outside clients see them, such as your own app or Postman; the app's own screens keep working. The app shows when faults are on.

**Develop:**
- **Card blocks:** build card code by snapping blocks together, then run it against a test transaction to see whether it approves or declines.
- **Card code:** write card code as JavaScript (`main.js` with its `env.json`) in a full code editor, with suggestions and error checking.
- **API reference:** every endpoint, with its parameters and what it returns, and the request in cURL, Node.js or Python. **Try it** sends a request from the app and shows the response.
- **Requests:** every call the sandbox received from your code, with headers, bodies, status and timing. Send one again, or copy it as a curl command.
- **OAuth tester:** try the sign-in and consent flow that apps use to access a user's accounts.

**Sandbox:**
- **Data & scenarios:** load a scenario, reset to the starter data, clear everything, or export and import the sandbox's data.
- **Settings:** open at login, the menu bar icon, and the ports the app uses.
- **Logs:** what each part of the app is doing, if something goes wrong.

Press **⌘K** (Mac) or **Ctrl+K** (Windows) to open the command palette: jump to any section or run any action from there.

## Card code and AI assistants
Card code you save goes into a library, so you can come back to it in either editor. A saved project saves as you type.

You can also let an AI assistant, such as Claude, write card code for you. Choose **Services → Connect an AI Assistant…**. It gives you the command for Claude Code, a configuration for Claude Desktop and other apps, and the server's address (`http://127.0.0.1:3020/mcp`). Your assistant can then do the following, as blocks or JavaScript:
- create, edit, rename and delete card code
- run it against test transactions
- open it in the app for you to see

If an editor has unsaved changes, the app asks before an assistant replaces them. Changes an assistant makes show up in the editor straight away.

The assistant connection only works from your own computer.

## Your data
Everything stays on your computer:
- **Mac:** `~/Library/Application Support/Investec Sandbox/`. **Services → Show Sandbox Data in Finder** opens it.
- **Windows:** `%APPDATA%\Investec Sandbox\`

The folder holds the sandbox's database (`sandbox.db`), your card code library (`card-code/`, one folder per project) and your settings. Deleted card code projects go to `card-code/.trash/`, in case you want them back.

When an update changes how data is stored, the app backs up your database as `sandbox.db.backup` first.

## Updates
Builds that support it check for new versions when they start. On a Mac, you can also choose **Investec Sandbox → Check for Updates…**. Unsigned Mac builds can't update themselves; download the new version from the [Releases page](https://github.com/devinpearson/investec-sandbox-app/releases) instead. Your data stays where it is.

## Troubleshooting
- **A service won't start, or a page says it's unavailable:** click the services indicator in the toolbar to restart that service and see its logs. **Services → Restart All** (⇧⌘R) restarts everything.
- **Your code can't reach the API:** check the address in the welcome sheet, or use **Services → Copy API URL**. If another program had port 3000 when the app started, the sandbox uses the next free port.
- **Your code gets errors that the app doesn't:** check whether **Faults** are on. The toolbar shows it.
- **macOS says the app is damaged and should be moved to the Bin:** this affected early downloads for Apple silicon Macs. Download the latest version instead. Or, after dragging the app to Applications, run this in Terminal, which tells macOS you trust the copy you downloaded:
  ```bash
  xattr -cr "/Applications/Investec Sandbox.app"
  ```
- **Start again with fresh data:** **Data & scenarios → Reset** brings back the starter data.

On a Mac, closing the window keeps the sandbox running so your code can still reach it; quit the app (⌘Q) to stop it.

## Uninstall
- **Mac:** drag **Investec Sandbox** from Applications to the Bin. To remove your data too, delete `~/Library/Application Support/Investec Sandbox/`.
- **Windows:** uninstall it from **Settings → Apps**. To remove your data too, delete `%APPDATA%\Investec Sandbox\`.

## Contributing
Want to build the app yourself or help improve it? See [CONTRIBUTING.md](CONTRIBUTING.md). [RELEASING.md](RELEASING.md) covers packaging and publishing releases.

## Licence
Investec Sandbox is released under the [MIT License](LICENSE).
