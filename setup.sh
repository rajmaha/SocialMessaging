#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Social Media Messaging System Setup${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check Python
echo -e "${YELLOW}Checking Python installation...${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓ Python found: $PYTHON_VERSION${NC}\n"
else
    echo -e "${RED}✗ Python 3 is required but not installed.${NC}"
    exit 1
fi

# Check PostgreSQL
echo -e "${YELLOW}Checking PostgreSQL installation...${NC}"
if command -v psql &> /dev/null; then
    echo -e "${GREEN}✓ PostgreSQL found${NC}\n"
else
    echo -e "${YELLOW}! PostgreSQL not found. Please install PostgreSQL${NC}\n"
fi

# Backend setup
echo -e "${YELLOW}Setting up backend...${NC}"
cd backend

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}! Created .env file. Please update it with your API keys${NC}"
fi

echo -e "${GREEN}✓ Backend setup complete${NC}\n"

# Frontend setup
cd ../frontend

echo -e "${YELLOW}Checking Node.js installation...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js found: $NODE_VERSION${NC}\n"
else
    echo -e "${YELLOW}! Node.js is required but not installed.${NC}"
    exit 1
fi

echo -e "${YELLOW}Setting up frontend...${NC}"

# Install Node dependencies
echo "Installing Node dependencies..."
npm install

# Create .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
    echo -e "${GREEN}✓ Created .env.local${NC}"
fi

echo -e "${GREEN}✓ Frontend setup complete${NC}\n"

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update backend/.env with your API keys"
echo "2. Create PostgreSQL database: createdb socialmedia"
echo "3. Start backend: cd backend && source venv/bin/activate && uvicorn main:app --reload"
echo "4. Start frontend: cd frontend && npm run dev"
echo "5. Open http://localhost:3000 in your browser\n"
