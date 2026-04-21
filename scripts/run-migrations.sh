#!/bin/bash

# Ahava Healthcare - Database Migration Runner
# Runs all migrations in order

echo "🗄️  Running Ahava Healthcare Database Migrations..."
echo ""

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js"
    exit 1
fi

# Determine if running locally or remote
REMOTE_FLAG=""
if [ "$1" == "--remote" ] || [ "$1" == "-r" ]; then
    REMOTE_FLAG="--remote"
    echo "🌐 Running migrations on PRODUCTION database"
else
    echo "💻 Running migrations on LOCAL development database"
fi

# Run migrations in order
for i in {1..10}; do
    echo ""
    echo "📝 Running migration $i/10..."
    
    if npx wrangler d1 execute DB --file=./migrations/$i.sql $REMOTE_FLAG; then
        echo "✅ Migration $i completed successfully"
    else
        echo "❌ Migration $i failed!"
        echo "Please fix the error and run again"
        exit 1
    fi
done

echo ""
echo "🎉 All migrations completed successfully!"
echo ""
echo "Verifying tables..."
npx wrangler d1 execute DB --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" $REMOTE_FLAG

echo ""
echo "✅ Database setup complete!"

