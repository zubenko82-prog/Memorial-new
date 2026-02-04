const ExcelJS = require("exceljs");

async function main() {
  const wb = new ExcelJS.Workbook();

  const catalog = wb.addWorksheet("Каталог");
  catalog.columns = [
    { header: "sku", key: "sku", width: 22 },
    { header: "group", key: "group", width: 12 },
    { header: "label", key: "label", width: 28 },
    { header: "price", key: "price", width: 10 },
    { header: "active", key: "active", width: 8 },
    { header: "tag_ru", key: "tag_ru", width: 28 },
  ];

  const add = (sku, group, label, tag_ru = "") =>
    catalog.addRow({ sku, group, label, price: 0, active: 1, tag_ru });

  [
    ["STELA_60_40_5", "Стела 60-40-5", "#стела_60x40x5"],
    ["STELA_60_40_8", "Стела 60-40-8", "#стела_60x40x8"],
    ["STELA_80_40_5", "Стела 80-40-5", "#стела_80x40x5"],
    ["STELA_80_40_8", "Стела 80-40-8", "#стела_80x40x8"],
    ["STELA_100_50_5", "Стела 100-50-5", "#стела_100x50x5"],
    ["STELA_100_50_8", "Стела 100-50-8", "#стела_100x50x8"],
    ["STELA_120_60_8", "Стела 120-60-8", "#стела_120x60x8"],
    ["STELA_140_60_8", "Стела 140-60-8", "#стела_140x60x8"],
    ["STELA_140_70_8", "Стела 140-70-8", "#стела_140x70x8"],
  ].forEach(([sku, label, tag]) => add(sku, "STELA", label, tag));

  [
    ["TUMBA_50_20_15", "Тумба 50-20-15"],
    ["TUMBA_60_20_15", "Тумба 60-20-15"],
    ["TUMBA_60_20_20", "Тумба 60-20-20"],
    ["TUMBA_70_20_20", "Тумба 70-20-20"],
    ["TUMBA_80_20_20", "Тумба 80-20-20"],
  ].forEach(([sku, label]) => add(sku, "TUMBA", label));

  [
    ["CVETNIK_100_50_8", "Цветник 100-50-8"],
    ["CVETNIK_120_60_8", "Цветник 120-60-8"],
  ].forEach(([sku, label]) => add(sku, "CVETNIK", label));

  [
    ["PLITA_80_40_5", "Плита 80-40-5", "#плита_80x40x5"],
    ["PLITA_100_50_5", "Плита 100-50-5", "#плита_100x50x5"],
    ["PLITA_120_60_5", "Плита 120-60-5", "#плита_120x60x5"],
  ].forEach(([sku, label, tag]) => add(sku, "PLITA", label, tag));

  [
    ["WORK_REZBA_1", "Резная работа ур.1", "#резная_работа"],
    ["WORK_REZBA_2", "Резная работа ур.2", "#резная_работа"],
    ["WORK_REZBA_3", "Резная работа ур.3", "#резная_работа"],
    ["WORK_REZBA_4", "Резная работа ур.4", "#резная_работа"],
    ["WORK_REZBA_5", "Резная работа ур.5", "#резная_работа"],
    ["WORK_FREZER_1", "Фрезерная работа ур.1", "#фрезерная_работа"],
    ["WORK_FREZER_2", "Фрезерная работа ур.2", "#фрезерная_работа"],
    ["WORK_FREZER_3", "Фрезерная работа ур.3", "#фрезерная_работа"],
    ["WORK_FREZER_4", "Фрезерная работа ур.4", "#фрезерная_работа"],
    ["WORK_FREZER_5", "Фрезерная работа ур.5", "#фрезерная_работа"],
  ].forEach(([sku, label, tag]) => add(sku, "WORK", label, tag));

  [
    ["OPT_PORTRAIT", "Портрет"],
    ["OPT_METRICA", "Метрика"],
  ].forEach(([sku, label]) => add(sku, "OPTION", label));

  for (let i = 1; i <= 5; i++) add(`GRAFIKA_${i}`, "GRAFIKA", `Графика ${i}`);

  catalog.getRow(1).font = { bold: true };
  catalog.views = [{ state: "frozen", ySplit: 1 }];
  catalog.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 6 },
  };

  const rules = wb.addWorksheet("Правила");
  rules.columns = [
    { header: "group", key: "group", width: 12 },
    { header: "required", key: "required", width: 10 },
    { header: "mode", key: "mode", width: 10 },
    { header: "allow_none", key: "allow_none", width: 12 },
  ];
  [
    ["STELA", 1, "single", 0],
    ["TUMBA", 1, "single", 0],
    ["CVETNIK", 0, "single", 1],
    ["PLITA", 0, "single", 1],
    ["WORK", 0, "single", 1],
    ["OPTION", 0, "multi", 1],
    ["GRAFIKA", 0, "multi", 1],
  ].forEach(([group, required, mode, allow_none]) =>
    rules.addRow({ group, required, mode, allow_none })
  );
  rules.getRow(1).font = { bold: true };
  rules.views = [{ state: "frozen", ySplit: 1 }];

  const bands = wb.addWorksheet("PriceBands");
  bands.columns = [
    { header: "min", key: "min", width: 12 },
    { header: "max", key: "max", width: 12 },
    { header: "tag_ru", key: "tag_ru", width: 18 },
  ];

  for (let start = 0; start < 500000; start += 50000) {
    const min = start === 0 ? 0 : start + 1;
    const max = start + 50000;
    bands.addRow({ min, max, tag_ru: `#до_${max}` });
  }
  bands.addRow({ min: 500001, max: 999999999, tag_ru: "#от_500000" });

  bands.getRow(1).font = { bold: true };
  bands.views = [{ state: "frozen", ySplit: 1 }];

  const posts = wb.addWorksheet("Публикации");
  posts.columns = [
    { header: "channel_id", key: "channel_id", width: 18 },
    { header: "message_id_caption", key: "message_id_caption", width: 20 },
    { header: "date", key: "date", width: 18 },
    { header: "items", key: "items", width: 60 },
    { header: "last_total_price", key: "last_total_price", width: 16 },
    { header: "status", key: "status", width: 10 },
  ];
  posts.getRow(1).font = { bold: true };
  posts.views = [{ state: "frozen", ySplit: 1 }];

  await wb.xlsx.writeFile("catalog.xlsx");
  console.log("Создан файл: catalog.xlsx");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
