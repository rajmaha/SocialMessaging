#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_LOG="/tmp/socialmedia_backend.log"
FRONTEND_LOG="/tmp/socialmedia_frontend.log"
PID_FILE="/tmp/socialmedia.pids"

# Kill any existing instances first
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    kill "$pid" 2>/dev/null
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 1

echo -e "${BLUE}Starting Social Media Messaging System...${NC}\n"

# Cleanup on exit
cleanup() {
  echo -e "\n${YELLOW}Stopping services...${NC}"
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo -e "${GREEN}Stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${YELLOW}Starting backend...${NC}"
cd "$BASE_DIR/backend"
source "$BASE_DIR/.venv/bin/activate"
nohup python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID >> "$PID_FILE"
echo -e "${GREEN}Backend started (PID: $BACKEND_PID) → $BACKEND_LOG${NC}"

# Wait for backend to be ready
echo -n "Waiting for backend..."
for i in {1..15}; do
  sleep 1
  if curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo -e " ${GREEN}ready!${NC}"
    break
  fi
  echo -n "."
done

# Start frontend
echo -e "${YELLOW}Starting frontend...${NC}"
cd "$BASE_DIR/frontend"
nohup npx next dev > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID >> "$PID_FILE"
echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID) → $FRONTEND_LOG${NC}\n"

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ System is running!${NC}"
echo -e "${BLUE}========================================${NC}\n"
echo "Backend API:  http://localhost:8000"
echo "API Docs:     http://localhost:8000/docs"
echo "Frontend:     http://localhost:3000"
echo ""
echo "Logs:  tail -f $BACKEND_LOG"
echo "       tail -f $FRONTEND_LOG"
echo ""
echo "Press Ctrl+C to stop both services"

# Keep script alive and monitor processes
while true; do
  sleep 5
  # Auto-restart frontend if it dies
  if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${YELLOW}Frontend crashed, restarting...${NC}"
    cd "$BASE_DIR/frontend"
    nohup npx next dev > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    # Update PID file
    grep -v "^$" "$PID_FILE" > /tmp/pids.tmp 2>/dev/null
    echo $FRONTEND_PID >> /tmp/pids.tmp
    mv /tmp/pids.tmp "$PID_FILE"
    echo -e "${GREEN}Frontend restarted (PID: $FRONTEND_PID)${NC}"
  fi
  # Auto-restart backend if it dies
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${YELLOW}Backend crashed, restarting...${NC}"
    cd "$BASE_DIR/backend"
    source "$BASE_DIR/.venv/bin/activate"
    nohup python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID >> "$PID_FILE"
    echo -e "${GREEN}Backend restarted (PID: $BACKEND_PID)${NC}"
  fi
done
