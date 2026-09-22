import { writeJournalExport } from "./team/export.js";
import { loadJournalRows } from "./team/journal.js";
import { exportDir } from "./team/paths.js";

const rows = loadJournalRows();
const written = writeJournalExport(rows, exportDir(), new Date());
console.log(`[bba] exported ${written.count} journal rows`);
console.log(`[bba] csv ${written.csvPath}`);
console.log(`[bba] jsonl ${written.jsonlPath}`);
