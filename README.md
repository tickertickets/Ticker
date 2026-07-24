# Ticker

A movie social platform built around a ticket-style rating card system. Users log movies they've watched, assign star ratings, and collect visually ranked "tickets" that reflect the cultural and critical weight of each film.

## Stack

| Layer    | Tech                                      |
|----------|-------------------------------------------|
| Frontend | React + Vite + TypeScript + Tailwind CSS  |
| Backend  | Node.js + Express + TypeScript            |
| Database | PostgreSQL                                |
| Auth     | Clerk                                     |
| Movie data | TMDB API                               |

## Production

| Service  | URL                                      |
|----------|------------------------------------------|
| Frontend | https://ticker-tickets.vercel.app        |
| API      | https://ticker-api-server.onrender.com   |

## Monorepo Structure

```
artifacts/
  ticker-web/     — React + Vite frontend (deployed to Vercel)
  api-server/     — Express REST API (deployed to Render)
lib/              — shared TypeScript types and utilities
```

## Card Rank System

Each movie receives a computed rank tier based on TMDB score, vote count, and cultural signals:

| Tier       | Abbr | Notes                          |
|------------|------|--------------------------------|
| Common     | C    | —                              |
| Uncommon   | U    | subtle silver shimmer          |
| Rare       | R    | silver shimmer                 |
| Super Rare | SR   | silver shimmer                 |
| Ultra Rare | UR   | silver shimmer                 |
| Legendary  | LEGENDARY | silver shimmer            |
| Cult Classic | CULT CLASSIC | rose shimmer on badge  |

Posted ticket cards with a 5-star user rating receive an additional gold holo shimmer (`ticket-shimmer-holo`).

## Running Locally

```bash
pnpm install

# frontend
pnpm --filter @workspace/ticker-web run dev

# api
pnpm --filter @workspace/api-server run dev
```

Requires a `.env` with `DATABASE_URL` and `TMDB_API_KEY`.
