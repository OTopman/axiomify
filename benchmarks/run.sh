#!/bin/bash
set -e

# --- ENFORCE NODE ENGINE ---
# Extract the major version number (e.g., "20" from "v20.11.0")
NODE_MAJOR=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)

if [ "$NODE_MAJOR" != "19" ] && [ "$NODE_MAJOR" != "20" ]; then
  echo "🚨 [ERROR] Invalid V8 Engine Detected!"
  echo "Benchmarks must be run on Node 19 or 20 to ensure accurate garbage collection metrics."
  echo "Current active version: $(node -v)"
  echo "Please switch your Node version (e.g., 'nvm use 20') and try again."
  exit 1
fi
echo "✅ Valid V8 Engine detected: $(node -v)"
# ---------------------------

# Ensure clean build
# echo "Building latest packages..."
# npm run build

# Define parameters
CONNECTIONS=100
DURATION=10
PIPELINING=10
URL="http://localhost:3000/ping"

run_benchmark() {
  local file=$1
  local name=$2

  echo "----------------------------------------"
  echo "Starting $name Server..."
  npx tsx "$file" &
  SERVER_PID=$!
  
  # Wait for server to boot
  sleep 2 

  echo "Running autocannon against $name..."
  npx autocannon -c $CONNECTIONS -d $DURATION -p $PIPELINING "$URL"

  echo "Stopping $name Server..."
  kill $SERVER_PID
  sleep 2
}

echo "Starting Benchmark Suite..."

run_benchmark "benchmarks/http.ts" "Raw Node HTTP"
run_benchmark "benchmarks/native.ts" "Axiomify Native"
run_benchmark "benchmarks/fastify.ts" "Fastify"
run_benchmark "benchmarks/hapi.ts" "Hapi"
run_benchmark "benchmarks/express.ts" "Express"

echo "----------------------------------------"
echo "Benchmark Suite Complete."