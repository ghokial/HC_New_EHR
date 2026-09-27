import { FileBlob, SpreadsheetFile } from "file:///C:/Users/ghoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const files = process.argv.slice(2);
for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheets = [];
  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange(true);
    const values = used ? used.values : [];
    const width = values.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    sheets.push({
      name: sheet.name,
      rows: values.length,
      columns: width,
      preview: values.slice(0, 15),
      tail: values.length > 15 ? values.slice(-2) : [],
    });
  }
  console.log(JSON.stringify({ file, sheets }));
}
