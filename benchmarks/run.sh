#!/bin/bash
echo "Building latest packages..."
npm run build
echo "Starting benchmark server..."
npx tsx benchmarks/http-baseline.ts &
SERVER_PID=$!
sleep 2

echo "Running autocannon..."
npx autocannon -c 100 -d 10 http://localhost:3000/bench

echo "Stopping server..."
kill $SERVER_PID
