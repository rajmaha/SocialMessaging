# Deployment Guide for Social Media Messaging System

## Deployment Options

### Option 1: Local Development (Recommended for Testing)

#### Prerequisites
- Python 3.8+
- Node.js 16+
- PostgreSQL 12+

#### Steps

1. **Clone and Setup**
   ```bash
   cd /path/to/SocialMedia
   chmod +x setup.sh
   ./setup.sh
   ```

2. **Configure Environment**
   ```bash
   # Backend
   cd backend
   nano .env
   # Update with your API keys
   
   # Frontend
   cd ../frontend
   nano .env.local
   ```

3. **Start Services**
   ```bash
   # Terminal 1 - Backend
   cd backend
   source venv/bin/activate
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   
   # Terminal 2 - Frontend
   cd frontend
   npm run dev
   ```

4. **Access Application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

### Option 2: Docker Compose (Recommended for Production-like Setup)

#### Prerequisites
- Docker
- Docker Compose

#### Steps

1. **Setup Configuration**
   ```bash
   # Create .env for backend
   cat > backend/.env << EOF
   DATABASE_URL=postgresql://socialmedia_user:socialmedia_password@db:5432/socialmedia
   DEBUG=False
   SECRET_KEY=your-secret-key-change-in-production
   WHATSAPP_API_KEY=your_key
   FACEBOOK_ACCESS_TOKEN=your_token
   VIBER_BOT_TOKEN=your_token
   LINKEDIN_ACCESS_TOKEN=your_token
   EOF
   ```

2. **Build and Start**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

3. **Access Application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - View logs: `docker-compose logs -f`

4. **Stop Services**
   ```bash
   docker-compose down
   ```

### Option 3: AWS Deployment

#### Using EC2

1. **Launch EC2 Instance**
   - AMI: Ubuntu 20.04 LTS
   - Instance Type: t3.medium or higher
   - Storage: 30GB+ EBS volume

2. **Install Dependencies**
   ```bash
   sudo apt-get update
   sudo apt-get install -y python3.11 python3-pip nodejs npm postgresql
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   ```

3. **Clone and Setup**
   ```bash
   git clone <your-repo-url> /opt/socialmedia
   cd /opt/socialmedia
   chmod +x setup.sh
   ./setup.sh
   ```

4. **Configure Environment**
   ```bash
   # Add your API keys to .env files
   ```

5. **Use Gunicorn for Production**
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:8000 main:app
   ```

6. **Setup Systemd Service** (Optional)
   ```bash
   sudo nano /etc/systemd/system/socialmedia-backend.service
   ```

#### Using Docker on ECR

1. **Push to Amazon ECR**
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
   docker build -t socialmedia-backend backend/
   docker tag socialmedia-backend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/socialmedia-backend:latest
   docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/socialmedia-backend:latest
   ```

2. **Deploy on ECS/Fargate**
   - Create task definitions for both backend and frontend
   - Configure security groups and load balancers
   - Deploy using ECS console or CLI

### Option 4: Heroku Deployment

1. **Prepare for Heroku**
   ```bash
   # Create Procfile
   echo "web: gunicorn main:app" > backend/Procfile
   echo "web: npm start" > frontend/Procfile
   ```

2. **Deploy Backend**
   ```bash
   cd backend
   heroku create socialmedia-api
   heroku addons:create heroku-postgresql:standard-0
   git push heroku main
   ```

3. **Deploy Frontend**
   ```bash
   cd ../frontend
   heroku create socialmedia-app
   heroku config:set NEXT_PUBLIC_API_URL=https://socialmedia-api.herokuapp.com
   git push heroku main
   ```

### Option 5: DigitalOcean App Platform

1. **Connect GitHub Repository**
   - Create app.yaml in root directory

2. **Deploy**
   ```bash
   doctl apps create --spec app.yaml
   ```

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://user:password@host:5432/socialmedia
DEBUG=True/False
SECRET_KEY=your-secret-key
ALGORITHM=HS256

# Platform APIs
WHATSAPP_API_KEY=your_key
WHATSAPP_PHONE_NUMBER_ID=your_id
FACEBOOK_ACCESS_TOKEN=your_token
FACEBOOK_PAGE_ID=your_id
VIBER_BOT_TOKEN=your_token
LINKEDIN_ACCESS_TOKEN=your_token
LINKEDIN_ORGANIZATION_ID=your_id

# CORS
FRONTEND_URL=http://localhost:3000
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Database Backups

### Automatic Backups
```bash
# Daily backup script
0 2 * * * pg_dump socialmedia > /var/backups/socialmedia-$(date +\%Y\%m\%d).sql
```

### Manual Backup
```bash
pg_dump socialmedia > backup.sql
psql socialmedia < backup.sql  # Restore
```

## Monitoring and Logging

### Backend Logs
```bash
docker-compose logs -f backend
# or
docker logs socialmedia_backend
```

### Database Logs
```bash
docker-compose logs -f db
```

### Monitor Performance
```bash
docker stats
# or
docker-compose stats
```

## Security Checklist

- [ ] Change default credentials
- [ ] Use HTTPS in production
- [ ] Set DEBUG=False
- [ ] Use environment variables for secrets
- [ ] Configure CORS properly
- [ ] Set up firewall rules
- [ ] Enable database encryption
- [ ] Use strong SECRET_KEY
- [ ] Implement rate limiting
- [ ] Regular security updates

## Troubleshooting

### Backend won't start
```bash
# Check logs
docker-compose logs backend

# Rebuild
docker-compose build --no-cache backend

# Reset database
docker-compose down
docker volume rm socialmedia_postgres_data
docker-compose up
```

### Frontend connection issues
```bash
# Check API URL
docker exec socialmedia_frontend env | grep NEXT_PUBLIC_API_URL

# Test backend connectivity
curl http://localhost:8000/health
```

### Database connection errors
```bash
# Check PostgreSQL
docker-compose logs db

# Verify credentials
docker exec socialmedia_db psql -U socialmedia_user -d socialmedia -c "SELECT 1"
```

## Production Checklist

- [ ] Database backups configured
- [ ] Monitoring setup (CloudWatch, DataDog, etc.)
- [ ] Alert system configured
- [ ] Log aggregation setup
- [ ] CI/CD pipeline configured
- [ ] SSL/TLS certificates installed
- [ ] Load balancer configured
- [ ] Auto-scaling setup
- [ ] Disaster recovery plan documented
- [ ] Security audit completed
