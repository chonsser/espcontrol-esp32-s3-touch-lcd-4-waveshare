# Change the Web Configurator

Use this for shared setup-page behavior, card editors, previews, browser state,
or the generated web bundles served by a device.

## Edit First

- `src/webserver/application/` for shared application behavior.
- `src/webserver/cards/<type>.ts` for card-specific settings or previews.
- `src/webserver/entry.ts` when registering a new shared module.
- `product/v2/translations/web.*.txt` for translated configurator text.

Keep module installation order explicit in `entry.ts`. Change model or contract
sources before their generated browser output.

Wrap new display text with the functions from `src/webserver/i18n/` as described
in [Web Configurator](../web-configurator.md#translations). Never wrap a value
that is saved, sent to the device, or compared in code.

## Regenerate

When display text was added, removed, or reworded, bring the catalogs in line
first, translate the new values in each `web.<lang>.txt`, and rebuild the
translation tables:

```bash
python3 scripts/build.py web-i18n --extract
python3 scripts/build.py web-i18n
python3 scripts/build.py web-i18n --check
```

Then rebuild the bundles:

```bash
python3 scripts/build.py www
```

Commit every web output produced by the generator. Use
[Source of Truth Contract](../source-of-truth.md) for the current output list;
do not edit a bundle directly.

## Stop If

- Generated files change without a corresponding authored web or profile input.
- An older installed panel would lose its compatibility loader or hosted bundle.
- A saved setting renders correctly but is lost after reload.
- A new module relies on implicit global installation order.
- English rendering changes, or a saved value, option value, or compared literal
  ends up inside a translation call.

## Verify

```bash
npm run check:web-smoke
npm run check:web-browser-smoke
npm run check:web-asset-manifest
```

Run `npm run check:product` when saved config, device profiles, shared models, or
release-facing web assets change. Run `npm run check:translations` when a
translation catalog changes.

## Test on a Display

Serve the generated embedded editor from the development machine:

```bash
python3 -m http.server 8080 --directory docs/public/webserver/embedded
```

Point the local device `dev.yaml` at
`http://<computer-ip>:8080/www.js`, open the device setup page, and hard reload
after every rebuild so the browser does not reuse an older `www.js`.

To test a translation, set `Screen: Language` on the Settings tab. The page
reloads once into that language and the panel follows a few seconds later.
On a factory build, open `http://<panel-ip>/?espcontrol_fallback=1` to use the
embedded bundle instead of the upstream UI. Do not replace a provisioned
panel's factory image with a development image just to test translations.
