# Social Media Messaging System - Git Configuration

## Initial Setup

```bash
git init
git add .
git commit -m "Initial commit: Social Media Messaging System with FastAPI backend and Next.js frontend"
```

## Branch Strategy

- `main` - Production ready code
- `develop` - Development branch
- `feature/*` - Feature branches
- `bugfix/*` - Bug fix branches

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation only changes
- `style:` Changes that don't affect code meaning
- `refactor:` Code change without feature or bug fix
- `perf:` Code change for performance
- `test:` Adding or updating tests
- `chore:` Changes to build process or dependencies

## Files to Never Commit

- `.env` - Environment variables with secrets
- `venv/` - Python virtual environment
- `node_modules/` - Node packages
- `.next/` - Next.js build output
- `__pycache__/` - Python cache
- `*.pyc` - Python compiled files
