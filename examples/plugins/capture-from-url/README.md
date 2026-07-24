# Capture from URL example plugin

This installable example demonstrates `api.cms.capture.fromUrl()`. It adds **Capture** to the admin navigation, where an operator can paste an HTTP(S) URL, choose the capture mode and scope, and preview the returned HTML/CSS alongside the `nextActions` JSON.

The server entrypoint is intentionally only a proxy: its authenticated `POST /capture` route requires the caller's `site.read` capability and passes the request body directly to the CMS capture SDK.

## Permissions

- `cms.routes` — registers the plugin runtime route used by the admin app.
- `cms.capture` — calls the host-managed URL capture pipeline.
- `admin.navigation` — adds the Capture admin page.
- `editor.code` — app-kind admin pages execute React code in the admin window and therefore require explicit consent.

The capture pipeline performs the network request on the plugin's behalf. Add the hosts you intend to capture to `networkAllowedHosts` in `instatic-plugin.config.ts`, for example:

```ts
networkAllowedHosts: ['example.com', '*.example.com'],
```

Use the narrowest production allowlist possible. A leading `*.` matches one subdomain segment. When changing the allowlist, rebuild and reinstall/update the plugin so the operator can review the package configuration.

## Build and install

From this directory (or pass this directory to the CLI from the repository root):

```sh
bun instatic-plugin build
# from the repository root:
bun instatic-plugin build examples/plugins/capture-from-url
```

The command creates a plugin zip in `dist/`. Start Instatic, sign in as an administrator, open **Plugins**, choose **Upload plugin**, select the generated `.plugin.zip`, review the requested permissions, and install/enable it. Open **Capture** in the admin navigation.

## Add capture presets

A preset is just a preselected `mode`, `scope`, and optional `selector`. Add preset buttons or a select control in `admin/workflow.tsx`, then update the corresponding React state (`setMode`, `setScope`, and `setSelector`). If a preset needs an asset limit, add `assetsMax` to the JSON body sent to the runtime route. No capture implementation belongs in `server/index.ts`; keep the route as a thin `api.cms.capture.fromUrl(body)` proxy.
