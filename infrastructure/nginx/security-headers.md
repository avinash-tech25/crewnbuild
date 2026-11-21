# Security headers for the two web apps (FE-09)

The production builds of `professional/frontend` and `partner/frontend` are static files; the
web server in front of them sends these headers. Replace `api.example.in` with the API
origin the build uses (`VITE_API_BASE_URL`). Each app's `src/app/csp.test.js` checks that
the app loads nothing from an origin these policies do not allow.

Neither app needs a third-party script, style or font: the fonts are self-hosted
(`src/assets/fonts`) and the Professional site's pictures are in `public/site-images`.
React's `style` props are applied through the CSSOM, which `style-src 'self'` allows; no
file contains an inline `<script>` or a `style="…"` attribute.

## Professional (`professional/frontend`)

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://*.amazonaws.com; media-src 'self' blob: https://*.amazonaws.com; connect-src 'self' https://api.example.in wss://api.example.in; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), geolocation=(self), microphone=()" always;
```

`https://*.amazonaws.com`: uploaded files and pictures served from S3 (signed URLs). If camera
streams come from the media gateway on another origin, add that origin to `media-src` and
`connect-src`.

## Partner (`partner/frontend`)

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://*.amazonaws.com https://tile.openstreetmap.org; connect-src 'self' https://api.example.in; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), geolocation=(self), microphone=()" always;
```

`https://tile.openstreetmap.org`: the map tiles (`MAP_TILES` in
`src/shared/constants/tracking.js`). With `VITE_MAP_TILE_URL` set to another tile server,
put that host here instead.
