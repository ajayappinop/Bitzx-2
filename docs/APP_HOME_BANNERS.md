# App home banners (mobile carousel)

Admin-managed promo carousel on the **mobile app home screen** (below quick actions, above market stats).

## Image storage

- Admin uploads **JPEG, PNG, or WebP** (max 10 MB).
- Server processes with PIL: center-crop + resize to **1200×490**, saves under **`/uploads/home_banners/{banner_id}-{hash}.jpg`**.
- MongoDB field **`image_url`**: e.g. `/uploads/home_banners/banner_abc123-deadbeef.jpg`.
- Static files served at `{API_ORIGIN}/uploads/...` (FastAPI `StaticFiles` mount).

Recommended source: wide landscape (e.g. 1600×700+).

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/app/home-banners` | Public |
| GET | `/api/admin/app-home-banners` | Admin JWT |
| PATCH | `/api/admin/app-home-banners/settings` | Admin |
| POST | `/api/admin/app-home-banners` | Admin |
| PATCH | `/api/admin/app-home-banners/{id}` | Admin |
| DELETE | `/api/admin/app-home-banners/{id}` | Admin |
| POST | `/api/admin/app-home-banners/{id}/image` | Admin (multipart) |

## Admin

**Settings → App home banners** (`/settings/app-home-banners`)

- Toggle carousel + auto-scroll interval
- Add/edit/delete slides
- Upload background image (processed server-side)
- CTA actions: Markets, Trade, Wallet, Wallet Swap, Futures, External URL

## Clients

| Client | Component | Where |
|--------|-----------|--------|
| Web | `HomeBannerCarousel`, `LandingHomeBanners` | `/dashboard`, `/` |
| Mobile | `HomeBannerCarousel` | Dashboard home |

Golden gradient overlay when no image; full-bleed photo when `image_url` is set.
