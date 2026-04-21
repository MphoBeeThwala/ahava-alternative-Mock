# Development Setup Guide

This guide will help you set up the Ahava Healthcare development environment on your local machine.

## Prerequisites

- **Operating System**: Linux (Ubuntu/Debian), macOS, or Windows with WSL
- **Node.js**: Version 20.0.0 or higher
- **Package Manager**: Yarn 4.3.1 (managed via Corepack)
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7+

## Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/MphoBeeThwala/ahava-healthcare.git
cd ahava-healthcare
```

### 2. Install Node.js and Dependencies

#### On Ubuntu/Debian:
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Enable Corepack for Yarn management
sudo corepack enable

# Install dependencies
corepack yarn install
```

#### On macOS:
```bash
# Install Node.js via Homebrew
brew install node

# Enable Corepack
corepack enable

# Install dependencies
corepack yarn install
```

### 3. Database Setup

#### PostgreSQL Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

#### Create Database and User
```bash
# Create database and user
sudo -u postgres psql -c "CREATE DATABASE \"ahava-healthcare\";"
sudo -u postgres psql -c "CREATE USER ahava_user WITH ENCRYPTED PASSWORD 'ahava_dev_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \"ahava-healthcare\" TO ahava_user;"
sudo -u postgres psql -c "ALTER USER ahava_user CREATEDB;"

# Grant schema permissions
sudo -u postgres psql -d ahava-healthcare -c "GRANT ALL ON SCHEMA public TO ahava_user;"
sudo -u postgres psql -d ahava-healthcare -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ahava_user;"
sudo -u postgres psql -d ahava-healthcare -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ahava_user;"
```

### 4. Redis Setup

**Ubuntu/Debian:**
```bash
sudo apt install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

### 5. Environment Configuration

The environment file is already configured with development settings:

```bash
# Backend environment is pre-configured at apps/backend/.env
# Key settings:
DATABASE_URL="postgresql://ahava_user:ahava_dev_password@localhost:5432/ahava-healthcare?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="7ec9236ab5e5107d9a783401cdb5d480febae88bafc7fad26e1a22443efe4891"
ENCRYPTION_KEY="4P96MokjojOYM0ddwS7n9ljjwXctaa0SYAxm5SHJC68="
ENCRYPTION_IV_SALT="15a00644246594a8854dd8678edc4f3c"
TIMEZONE="Africa/Johannesburg"
```

### 6. Database Migration

```bash
# Generate Prisma client and run migrations
corepack yarn prisma:generate
corepack yarn prisma:migrate
```

### 7. Start Development Servers

```bash
# Start all services
corepack yarn dev

# Or start individual services:
corepack yarn dev:api      # Backend API (port 4000)
corepack yarn dev:admin    # Admin portal (port 3000)
corepack yarn dev:doctor   # Doctor portal (port 3001)
corepack yarn dev:patient  # Patient app (port 19006)
corepack yarn dev:nurse    # Nurse app (port 19007)
corepack yarn dev:worker   # Background worker
```

## Development Commands

### Package Management
```bash
# Install dependencies
corepack yarn install

# Add new dependency
corepack yarn workspace @ahava-healthcare/api add <package>

# Add dev dependency
corepack yarn workspace @ahava-healthcare/api add -D <package>
```

### Database Operations
```bash
# Generate Prisma client
corepack yarn prisma:generate

# Create new migration
corepack yarn workspace @ahava-healthcare/api prisma migrate dev --name <migration-name>

# Reset database
corepack yarn db:reset

# Seed database
corepack yarn prisma:seed
```

### Testing
```bash
# Run all tests
corepack yarn test

# Run backend tests only
corepack yarn test:backend

# Run frontend tests only
corepack yarn test:web
```

### Code Quality
```bash
# Lint code
corepack yarn lint

# Fix linting issues
corepack yarn lint:fix

# Type checking
corepack yarn type-check
```

## Project Structure

```
ahava-healthcare/
├── apps/
│   ├── backend/          # Express.js API server
│   │   ├── src/          # Source code
│   │   ├── prisma/       # Database schema and migrations
│   │   ├── .env          # Environment variables
│   │   └── package.json  # Backend dependencies
│   ├── admin/            # Next.js admin portal (to be implemented)
│   ├── doctor/           # Next.js doctor portal (to be implemented)
│   ├── patient/          # Patient mobile/web app (to be implemented)
│   ├── nurse/            # Nurse mobile app (to be implemented)
│   └── worker/           # Background job processor (to be implemented)
├── packages/
│   ├── shared/           # Shared utilities and types (to be implemented)
│   └── ui/               # Reusable UI components (to be implemented)
├── deploy/               # Deployment configurations
├── docs/                 # Documentation
└── package.json          # Root package configuration
```

## Troubleshooting

### Common Issues

1. **Yarn Version Conflicts**
   ```bash
   # Ensure Corepack is enabled
   sudo corepack enable
   corepack prepare yarn@4.3.1 --activate
   ```

2. **Database Connection Issues**
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Check Redis status
   sudo systemctl status redis-server
   
   # Test database connection
   psql -h localhost -U ahava_user -d ahava-healthcare
   ```

3. **Permission Issues**
   ```bash
   # Fix database permissions
   sudo -u postgres psql -d ahava-healthcare -c "GRANT ALL ON SCHEMA public TO ahava_user;"
   ```

4. **Port Conflicts**
   - Backend API: Port 4000
   - Admin Portal: Port 3000
   - Doctor Portal: Port 3001
   - Patient App: Port 19006
   - Nurse App: Port 19007
   - Redis: Port 6379
   - PostgreSQL: Port 5432

### Environment Variables

All sensitive configuration is managed through environment variables:

- **Development**: Uses `.env` files in each app directory
- **Production**: Managed by deployment platform (Railway/Render/Fly.io)
- **Security**: JWT secrets and encryption keys are auto-generated

## Next Steps

1. **Backend Development**: Complete API route implementations
2. **Frontend Applications**: Build admin, doctor, patient, and nurse interfaces
3. **Testing**: Implement comprehensive test suites
4. **Deployment**: Set up production environments
5. **Documentation**: Complete API documentation and user guides

## Support

For development support:

- **Issues**: [GitHub Issues](https://github.com/MphoBeeThwala/ahava-healthcare/issues)
- **Documentation**: [Project Wiki](https://github.com/MphoBeeThwala/ahava-healthcare/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/MphoBeeThwala/ahava-healthcare/discussions)
