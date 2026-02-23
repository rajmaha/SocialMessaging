#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}Starting Social Media Messaging System...${NC}\n"

# Start backend
echo -e "${YELLOW}Starting backend...${NC}"
cd "$BASE_DIR/backend"
$BASE_DIR/backend/venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo -e "${GREEN}Backend started (PID: $BACKEND_PID)${NC}"

# Wait a moment for backend to start
sleep 3

# Start frontend
cd "$BASE_DIR/frontend"
echo -e "${YELLOW}Starting frontend...${NC}"
npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID)${NC}\n"

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ System is running!${NC}"
echo -e "${BLUE}========================================${NC}\n"
echo "Backend API: http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo "Frontend: http://localhost:3000\n"
echo "Press Ctrl+C to stop both services\n"

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
