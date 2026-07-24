#!/bin/bash
export PORT=8080
export NODE_ENV=development
cd /home/runner/workspace/artifacts/api-server
(fuser -k 8080/tcp 2>/dev/null || true)
sleep 1
(pnpm --filter @workspace/db run push --force 2>/dev/null || true)
pnpm run build && pnpm run start
