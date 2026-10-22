# Running weave-ui as its own server

weave ADR-0245 §2: weave serves the API and the CLI; weave-ui is a separate server on its own port that reads view
models from weave's `/api/v1` with a scoped credential, `WEAVE_CONSOLE_SECRET`, and is the only thing a browser talks
to. weave runs with or without it.

## 1. Mint the console credential (on weave's host)

```sh
weave secret set --generate WEAVE_CONSOLE_SECRET   # 32 random bytes into the sealed store; prints nothing
# restart weave so it loads the new secret (live reload is not built)
```

It may read the console's views and `/api/v1/changes` and take every console action except halting or resuming the
fleet. Halt and resume stay on the command line: `weave halt`, `weave resume`. Every action it takes is on the log as
`gateway:console`.

## 2. Build a checkout

```sh
git clone https://git.local/gary/weave-ui.git ~/.local/share/weave-ui
cd ~/.local/share/weave-ui && bun install --frozen-lockfile && bun run build
```

## 3. Run it

Ad hoc, from the checkout (the secret goes from weave's store straight into the process, never onto disk):

```sh
WEAVE_URL=http://127.0.0.1:8788 weave secret exec WEAVE_CONSOLE_SECRET -- node --import tsx src/server/serve.ts
```

As a systemd user service:

```sh
cp deploy/systemd/weave-ui.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/weave-ui.service      # WEAVE_URL, and optionally port / host / trusted networks
systemctl --user daemon-reload && systemctl --user enable --now weave-ui
journalctl --user -u weave-ui -f                      # the banner names the URL it listens on
```

Never put the secret in the unit, an `EnvironmentFile`, `peer.env` or any other file: the unit gets it from
`weave secret exec` at start. The unit expects weave's store on the same host; a weave-ui on another host needs the
value moved there by hand (ADR-0245 §3) and a way to inject it, which this template does not cover yet.

## Settings

| Variable / flag | Default | Meaning |
|---|---|---|
| `WEAVE_URL` | — (required) | weave's console port. `http:` only to loopback; off loopback use `https:` — weave-ui checks `/health`'s `x-weave-cert-hmac` over the certificate it sees before it sends the secret (ADR-0064 channel binding) |
| `WEAVE_CONSOLE_SECRET` | — (required) | the console credential, from the environment only |
| `WEAVE_UI_PORT` | `8790` | where weave-ui listens |
| `WEAVE_UI_HOST` | `127.0.0.1` | the address it binds |
| `--trust-cidr <cidr>` / `WEAVE_UI_TRUST_CIDR` | none | networks admitted besides loopback (ADR-0220's rule: socket address, a `Host` no stranger can point here, no cross-site fetch) |
| `--insecure-upstream` | off | allow plain `http:` to a weave off loopback; the banner and `/health` say so |

## What a browser gets

The eight pages at their own URLs (`/`, `/work`, `/control`, `/factory`, `/machines`, `/team`, `/task?id=`, `/audit`),
their fragments (`/ui/f/<view>`) and actions (`/ui/a/<verb>`), the assets, `/events` (live changes, fanned out from
one subscription to weave), `/file?path=&task=`, and `/health`. Every response carries the CSP; none carries CORS.
A request from any address other than loopback or a trusted network gets a page saying how to admit it — there is no
login in P2 (accounts and passkeys move at ADR-0245 P4).
