// Generates backend/data/demo-orders.csv and backend/data/demo-payments.csv
// from the same deterministic generator the server uses. Run with:
//   npm run generate-data
const fs = require("fs");
const path = require("path");
const demo = require("../backend/demo");

const { orders, payments } = demo.buildDemo();
const { orderCsv, payCsv } = demo.toCsv(orders, payments);

const dir = path.join(__dirname, "..", "backend", "data");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "demo-orders.csv"), orderCsv);
fs.writeFileSync(path.join(dir, "demo-payments.csv"), payCsv);

console.log(`Wrote ${orders.length} orders and ${payments.length} payments to backend/data/`);