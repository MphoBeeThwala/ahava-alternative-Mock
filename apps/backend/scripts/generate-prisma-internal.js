/**
 * Generate Prisma client using Prisma's internal generator API
 * This completely bypasses the CLI and its resolution checks
 */

const path = require('path');
const fs = require('fs');

async function generatePrismaClient() {
  try {
    const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
    const rootDir = path.resolve(__dirname, '../../..');
    const outputPath = path.join(rootDir, 'node_modules/.prisma/client');
    
    console.log('🔄 Generating Prisma client using internal API...');
    console.log(`Schema: ${schemaPath}`);
    console.log(`Output: ${outputPath}`);
    
    // Read the schema
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // Use Prisma's internal generator
    const { getDMMF } = require('@prisma/internals');
    const { formatSchema } = require('@prisma/internals');
    
    // Parse the schema to DMMF
    const dmmf = await getDMMF({
      datamodel: schema,
      previewFeatures: [],
    });
    
    console.log('✅ Schema parsed successfully');
    console.log(`   Models: ${dmmf.datamodel.models.length}`);
    console.log(`   Enums: ${dmmf.datamodel.enums.length}`);
    
    // Now we need to actually generate the client
    // Prisma uses a generator system - we need to invoke the client generator
    const { generatorHandler } = require('@prisma/generator-helper');
    
    // Create generator options
    const generatorOptions = {
      generator: {
        name: 'prisma-client-js',
        provider: 'prisma-client-js',
        output: outputPath,
        previewFeatures: [],
      },
      otherGenerators: [],
      schemaPath: schemaPath,
      dmmf: dmmf,
      datasources: dmmf.datamodel.datasources,
      datamodel: dmmf.datamodel,
    };
    
    // Invoke the generator
    await generatorHandler(generatorOptions);
    
    console.log('✅ Prisma client generated successfully!');
    console.log(`   Location: ${outputPath}`);
    
    // Verify the client was generated
    const indexFile = path.join(outputPath, 'index.js');
    if (fs.existsSync(indexFile)) {
      console.log('✅ Client files verified');
    } else {
      throw new Error('Client files not found after generation');
    }
    
  } catch (error) {
    console.error('❌ Error generating Prisma client:', error.message);
    console.error(error.stack);
    throw error;
  }
}

generatePrismaClient()
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  });

