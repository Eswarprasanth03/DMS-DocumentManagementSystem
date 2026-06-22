// One-off maintenance: empty the database but KEEP users, and remove all
// stored files (GridFS). Run with the API stopped:  node tools/empty-db.mjs
import * as mongo from '../src/mongo.js'
import { config } from '../src/config.js'

if (config.dbDriver !== 'mongo') {
  console.error('This script targets MongoDB. DB_DRIVER is', config.dbDriver)
  process.exit(1)
}

await mongo.connect(config.mongoUri, config.mongoDb)

const before = await mongo.loadAll(['users', 'folders', 'documents', 'versions', 'trips', 'bonds', 'audit', 'envelopes', 'notifications'])
console.log('Before:')
for (const [k, v] of Object.entries(before)) console.log(`  ${k}: ${v.length}`)

// Everything except 'users'. dropAll also clears the meta collection.
const toClear = ['folders', 'documents', 'versions', 'trips', 'bonds', 'audit', 'envelopes', 'notifications']
await mongo.dropAll(toClear)
await mongo.gridfsClear()

const after = await mongo.loadAll(['users', 'folders', 'documents', 'versions', 'trips', 'bonds', 'audit', 'envelopes', 'notifications'])
console.log('\nAfter:')
for (const [k, v] of Object.entries(after)) console.log(`  ${k}: ${v.length}`)

await mongo.close()
console.log('\nDone — users kept, everything else (incl. GridFS files) cleared.')
process.exit(0)
