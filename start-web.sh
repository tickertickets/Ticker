#!/bin/bash
export PORT=5000
export API_PROXY_TARGET=http://localhost:8080
cd /home/runner/workspace
pnpm --filter @workspace/ticker-web run dev
