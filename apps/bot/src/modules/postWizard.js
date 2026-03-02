// apps/bot/src/modules/postWizard.js
import ExcelJS from 'exceljs';
import { Markup } from 'telegraf';

function makeSourceTokenForPost(absChatId, messageId) {
  return `p_${absChatId}_${messageId}_${Math.random().toString(16).slice(2)}`;
}

function formatRub(n) {
  const s = Math.round(Number(n) || 0).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// --- helpers ---
const normStr = (v) => String(v || '').trim();
const up = (v) => normStr(v).toUpperCase();

function normalizeSelectedToSkuList(selected) {
  const res = [];
  for (const v of Object.values(selected || {})) {
    if (!v) continue;
    if (Array.isArray(v)) res.push(...v);
    else res.push(v);
  }
  const seen = new Set();
  const out = [];
  for (const sku of res) {
    if (!seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

function pickBandTag(bands, total) {
  for (const b of bands) {
    if (total >= b.min && total <= b.max) return b.tag;
  }
  return '';
}

function isOptionItem(it) {
  const g = up(it.group);
  const sku = up(it.sku);
  return g === 'OPTION' || sku.startsWith('OPT_');
}

function isGrafikaItem(it) {
  const g = up(it.group);
  const sku = up(it.sku);
  return g === 'GRAFIKA' || sku.startsWith('GRAF_');
}

function calcCaptionAndTags({ items, bands }, selected) {
  const skuList = normalizeSelectedToSkuList(selected);
  const bySku = new Map(items.map((it) => [it.sku, it]));
  let total = 0;

  let stelaTag = '';
  let plitaTag = '';
  let workTag = '';
  let hasPlita = false;
  let hasCvetnik = false;

  for (const sku of skuList) {
    const it = bySku.get(sku);
    if (!it) continue;
    total += Number(it.price || 0);

    if (it.group === 'STELA' && it.tag_ru) stelaTag = it.tag_ru;
    if (it.group === 'PLITA') {
      hasPlita = true;
      if (it.tag_ru) plitaTag = it.tag_ru;
    }
    if (it.group === 'CVETNIK') hasCvetnik = true;
    if (it.group === 'WORK' && it.tag_ru) workTag = it.tag_ru;
  }

  const tags = [];
  if (stelaTag) tags.push(stelaTag);
  if (hasPlita) {
    if (plitaTag) tags.push(plitaTag);
  } else {
    tags.push('#без_плиты');
  }
  if (!hasCvetnik) tags.push('#без_цветника');
  if (workTag) tags.push(workTag);

  const bandTag = pickBandTag(bands, total);
  if (bandTag) tags.push(bandTag);

  const uniq = [];
  const seen = new Set();
  for (const t of tags) {
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      uniq.push(t);
    }
  }

  const caption = `Цена: от ${formatRub(total)} ₽\n${uniq.join(' ')}`.trim();
  return { total, tags: uniq, caption };
}

async function loadCatalogFromXlsx(CATALOG_XLSX_PATH) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CATALOG_XLSX_PATH);

  const wsCat = wb.getWorksheet('Каталог');
  if (!wsCat) throw new Error('В catalog.xlsx отсутствует лист "Каталог".');

  const header = wsCat.getRow(1).values;
  const colIndex = (name) => header.findIndex((v) => String(v || '').trim() === name);

  const idxSku = colIndex('sku');
  const idxGroup = colIndex('group');
  const idxLabel = colIndex('label');
  const idxPrice = colIndex('price');
  const idxActive = colIndex('active');
  const idxTag = colIndex('tag_ru');

  if ([idxSku, idxGroup, idxLabel, idxPrice, idxActive].some((i) => i < 1)) {
    throw new Error('Лист "Каталог" должен содержать колонки: sku, group, label, price, active, tag_ru');
  }

  const items = [];
  wsCat.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const sku = normStr(row.getCell(idxSku).value);
    if (!sku) return;

    const active = row.getCell(idxActive).value;
    const isActive = String(active).trim() === '1' || active === 1 || active === true;
    if (!isActive) return;

    const group = normStr(row.getCell(idxGroup).value).toUpperCase();
    const label = normStr(row.getCell(idxLabel).value) || sku;
    const price = Number(row.getCell(idxPrice).value || 0);
    const tag_ru = normStr(row.getCell(idxTag)?.value);

    items.push({ sku, group, label, price, tag_ru });
  });

  const wsBands = wb.getWorksheet('PriceBands');
  if (!wsBands) throw new Error('В catalog.xlsx отсутствует лист "PriceBands".');

  const headerB = wsBands.getRow(1).values;
  const bMin = headerB.findIndex((v) => String(v || '').trim() === 'min');
  const bMax = headerB.findIndex((v) => String(v || '').trim() === 'max');
  const bTag = headerB.findIndex((v) => String(v || '').trim() === 'tag_ru');
  if ([bMin, bMax, bTag].some((i) => i < 1)) {
    throw new Error('Лист "PriceBands" должен содержать колонки: min, max, tag_ru');
  }

  const bands = [];
  wsBands.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const min = Number(row.getCell(bMin).value);
    const max = Number(row.getCell(bMax).value);
    const tag = normStr(row.getCell(bTag).value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !tag) return;
    bands.push({ min, max, tag });
  });

  return { items, bands };
}

export { loadCatalogFromXlsx };

export function registerPostWizard(bot, deps) {
  const {
    HINT_TEXT,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    CATALOG_XLSX_PATH,
    getChannelId,
    isAdmin,
    setPostMeta,
    CHANNEL_USERNAME,
    setCatalogPostMeta,
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
    deleteCatalogPostMetaByKey, // ✅ добавили
  } = deps;

  // ====== UI ======
  const kbPostMenu = () =>
    Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();

  // ✅ добавили кнопку очистки
  const kbUpdateMenu = () =>
    Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['🧹 Очистить отсутствующие'], ['⬅️ Назад'], ['Отменить']]).resize();

  const editFieldMenuKb = () =>
    Markup.keyboard([
      ['🪧 Стела', '🧱 Тумба'],
      ['🌿 Цветник', '🪨 Плита'],
      ['🛠 Работа', '➕ Опции'],
      ['🎨 Графика', '🚀 Опубликовать'],
      ['⬅️ Назад', 'Отменить'],
    ]).resize();

  const stepsOrder = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'OPTION', 'GRAFIKA', 'PREVIEW'];

  function makeChannelPostLink(chatId, messageId) {
    if (CHANNEL_USERNAME) return `https://t.me/${String(CHANNEL_USERNAME).replace('@', '')}/${messageId}`;
    if (typeof chatId === 'string' && chatId.startsWith('@')) return `https://t.me/${chatId.replace('@', '')}/${messageId}`;
    const n = Number(chatId);
    if (Number.isFinite(n)) {
      const abs = Math.abs(n);
      return `https://t.me/c/${abs}/${messageId}`;
    }
    return '';
  }

  function channelPostKbFull(botUsername, sourceToken) {
    const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
    const webAppUrl = new URL(WEBAPP_URL).toString();
    return Markup.inlineKeyboard([
      [
        Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
        Markup.button.webApp('Подобрать памятник', webAppUrl),
      ],
    ]);
  }

  function channelPostKbFallback(botUsername, sourceToken) {
    const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
    const webAppUrl = new URL(WEBAPP_URL).toString();
    return Markup.inlineKeyboard([
      [Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)],
      [Markup.button.url('Подобрать памятник', webAppUrl)],
    ]);
  }

  async function postToChannelWithKb(ctx, kind, payload, baseTextNoHint) {
    const chatId = getChannelId();
    if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');
    const me = ctx.botInfo || (await ctx.telegram.getMe());
    const botUsername = me.username;

    const isHtmlIssue = (desc) => /parse entities|can't parse entities|entity|wrong entity/i.test(desc);
    const isWebAppIssue = (desc) =>
      /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

    const trySendNoKb = async ({ useHtml }) => {
      const common = { ...(useHtml ? { parse_mode: 'HTML' } : {}) };

      if (kind === 'text') {
        return await ctx.telegram.sendMessage(chatId, payload.text, { ...common, disable_web_page_preview: true });
      }
      if (kind === 'photo') {
        return await ctx.telegram.sendPhoto(chatId, payload.fileId, {
          ...common,
          caption: (payload.caption || '').slice(0, 1024),
        });
      }
      if (kind === 'video') {
        return await ctx.telegram.sendVideo(chatId, payload.fileId, {
          ...common,
          caption: (payload.caption || '').slice(0, 1024),
        });
      }
      if (kind === 'document') {
        const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
        return await ctx.telegram.sendDocument(chatId, payload.fileId, { ...common, caption: canCaption });
      }
      throw new Error('Unknown kind');
    };

    let msg;
    try {
      msg = await trySendNoKb({ useHtml: true });
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      if (isHtmlIssue(desc)) msg = await trySendNoKb({ useHtml: false });
      else throw e;
    }

    const absChatId = Math.abs(Number(msg.chat.id));
    const sourceToken = makeSourceTokenForPost(absChatId, msg.message_id);

    const kbFull2 = channelPostKbFull(botUsername, sourceToken).reply_markup;
    const kbFallback2 = channelPostKbFallback(botUsername, sourceToken).reply_markup;

    try {
      await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFull2);
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      if (isWebAppIssue(desc)) {
        await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFallback2);
      } else {
        console.warn('[bot] cannot set reply_markup:', desc);
      }
    }

    const mediaInfo = {};
    if (kind === 'photo' && payload.fileId) {
      mediaInfo.mediaType = 'photo';
      mediaInfo.fileId = payload.fileId;
    } else if (kind === 'video' && payload.fileId) {
      mediaInfo.mediaType = 'video';
      mediaInfo.fileId = payload.fileId;
    } else if (kind === 'document' && payload.fileId) {
      mediaInfo.mediaType = 'document';
      mediaInfo.fileId = payload.fileId;
    }

    await setPostMeta(sourceToken, {
      text: (baseTextNoHint || '').trim(),
      channelUsername: CHANNEL_USERNAME,
      messageId: msg.message_id,
      absChatId,
      ...mediaInfo,
    });

    return { primary: msg, sourceToken };
  }

  async function describeSelected(selected) {
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { items } = catalog;
    const map = new Map(items.map((it) => [it.sku, it]));

    const one = (sku) => (sku ? map.get(sku)?.label || sku : '— Нет —');
    const many = (arr) => (Array.isArray(arr) && arr.length ? arr.map((sku) => map.get(sku)?.label || sku).join(', ') : '—');

    const { total } = calcCaptionAndTags(catalog, selected);

    return [
      `🪧 Стела: ${one(selected?.STELA)}`,
      `🧱 Тумба: ${one(selected?.TUMBA)}`,
      `🌿 Цветник: ${one(selected?.CVETNIK)}`,
      `🪨 Плита: ${one(selected?.PLITA)}`,
      `🛠 Работа: ${one(selected?.WORK)}`,
      `➕ Опции: ${many(selected?.OPTION)}`,
      `🎨 Графика: ${many(selected?.GRAFIKA)}`,
      ``,
      `Цена: от ${formatRub(total)} ₽`,
    ].join('\n');
  }

  async function askStep(ctx, step) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    let list = [];
    if (step === 'OPTION') list = items.filter(isOptionItem);
    else if (step === 'GRAFIKA') list = items.filter(isGrafikaItem);
    else list = items.filter((it) => it.group === step);

    if (!list.length) return advance(ctx);

    const buttons = list.map((it) => it.label || it.sku);
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    const optionalSingles = ['CVETNIK', 'PLITA', 'WORK'];
    if (optionalSingles.includes(step)) rows.push(['— Нет —']);

    rows.push(['Отменить']);
    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Работа (или — Нет —):',
      OPTION: 'Опции (можно несколько). Нажмите «Далее» когда закончите:',
      GRAFIKA: 'Графика (можно несколько). Нажмите «Далее» когда закончите:',
    };

    if (step === 'OPTION' || step === 'GRAFIKA') rows.unshift(['Далее', 'Сбросить']);
    await ctx.reply(titleMap[step] || `Выберите ${step}:`, Markup.keyboard(rows).resize());
  }

  async function advance(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const idx = stepsOrder.indexOf(wiz.step);
    wiz.step = stepsOrder[idx + 1] || 'PREVIEW';

    if (wiz.step === 'PREVIEW') return preview(ctx);
    return askStep(ctx, wiz.step);
  }

  async function preview(ctx) {
    const wiz = ctx.session.postWizard;
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { caption } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = normStr(wiz.baseTextNoHint);
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    await ctx.reply(`Предпросмотр:\n\n${fullCaption}`);
  }

  async function editPostTextOrCaption(ctx, { chatId, messageId }, textOrCaption, kind) {
    try {
      if (kind === 'text') {
        await ctx.telegram.editMessageText(chatId, messageId, undefined, textOrCaption, { disable_web_page_preview: true });
      } else {
        await ctx.telegram.editMessageCaption(chatId, messageId, undefined, textOrCaption);
      }
      return { changed: true };
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      if (/message is not modified/i.test(desc)) return { changed: false };
      throw e;
    }
  }

  async function applySelectedToMessage(ctx, { chatId, messageId }, baseTextNoHint, selected, metaKind) {
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { caption, total } = calcCaptionAndTags(catalog, selected);

    const baseText = normStr(baseTextNoHint);
    const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

    const kind = metaKind || 'photo';
    const { changed } = await editPostTextOrCaption(ctx, { chatId, messageId }, newCaption, kind);

    await setCatalogPostMeta(messageId, {
      selected,
      baseTextNoHint: baseText,
      last_total_price: total,
      updatedAt: Date.now(),
      channelChatId: chatId,
      kind,
      messageId,
    });

    return { total, changed, kind };
  }

  // ====== /post ======
  bot.command('post', async (ctx) => {
    const channelId = getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
    if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');

    const raw = ctx.message?.text || '';
    const baseTextNoHint = raw.replace(/^\/post(@\S+)?\s*/i, '').trim();

    const r = ctx.message?.reply_to_message;
    const mediaPayload = {};
    if (r?.photo?.length) {
      mediaPayload.kind = 'photo';
      mediaPayload.fileId = r.photo.at(-1).file_id;
    } else if (r?.video) {
      mediaPayload.kind = 'video';
      mediaPayload.fileId = r.video.file_id;
    } else if (r?.document) {
      mediaPayload.kind = 'document';
      mediaPayload.fileId = r.document.file_id;
    } else {
      mediaPayload.kind = 'text';
    }

    ctx.session.postWizard = {
      step: 'menu',
      mode: 'new',
      editTarget: null,
      editMeta: null,
      baseTextNoHint,
      mediaPayload,
      selected: { STELA: null, TUMBA: null, CVETNIK: null, PLITA: null, WORK: null, OPTION: [], GRAFIKA: [] },
    };

    return ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('▶️ Новая публикация', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();
    const wiz = ctx.session.postWizard;
    wiz.mode = 'new';
    wiz.editTarget = null;
    wiz.editMeta = null;
    wiz.step = 'STELA';
    return askStep(ctx, 'STELA');
  });

  bot.hears('♻️ Обновить цены', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();
    ctx.session.postWizard.step = 'update_prices_menu';
    return ctx.reply(
      'Обновление постов:\n\n1) «🧾 Обновить по пересланному посту» — точечное редактирование выбранного поста.\n2) «🔁 Обновить все» — пересчитать цены.\n3) «🧹 Очистить отсутствующие» — удалить из базы посты, которых уже нет.',
      kbUpdateMenu()
    );
  });

  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard) return next();
    ctx.session.postWizard.step = 'menu';
    return ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('Отменить', async (ctx, next) => {
    if (!ctx.session?.postWizard) return next();
    ctx.session.postWizard = null;
    return ctx.reply('Отменено.', Markup.removeKeyboard());
  });

  bot.hears('🧾 Обновить по пересланному посту', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices_menu') return next();
    ctx.session.postWizard.step = 'edit_wait_post';
    return ctx.reply(
      'Перешлите сюда ОРИГИНАЛЬНЫЙ пост из канала, который нужно изменить.',
      Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  // ✅ Реальная очистка: удаляем ключи catalogpost:* если Telegram говорит "message to edit not found"
  bot.hears('🧹 Очистить отсутствующие', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices_menu') return next();
    if (typeof deleteCatalogPostMetaByKey !== 'function') {
      return ctx.reply('deleteCatalogPostMetaByKey не передан из bot.js. Проверьте прокидывание deps.');
    }

    await ctx.reply('Проверяю посты и УДАЛЯЮ из базы те, которых уже нет...');

    const keys = await getAllCatalogPostKeys();
    if (!Array.isArray(keys) || keys.length === 0) {
      await ctx.reply('Нет записей.');
      return;
    }

    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    let checked = 0;
    let deleted = 0;
    let skipped = 0;

    for (const key of keys) {
      const meta = await getCatalogPostMetaByKey(key);
      const messageIdStr = String(key).replace(/^catalogpost:/, '');
      const messageId = Number(messageIdStr);

      if (!meta?.selected || !meta?.channelChatId || !Number.isFinite(messageId)) {
        skipped++;
        continue;
      }

      try {
        const { caption } = calcCaptionAndTags(catalog, meta.selected);
        const baseText = normStr(meta.baseTextNoHint);
        const txt = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

        await editPostTextOrCaption(ctx, { chatId: meta.channelChatId, messageId }, txt, meta.kind || 'photo');
      } catch (e) {
        const desc = e?.response?.description || e?.message || String(e);
        if (/message to edit not found/i.test(desc)) {
          await deleteCatalogPostMetaByKey(key);
          deleted++;
        }
      } finally {
        checked++;
      }
    }

    await ctx.reply(`Готово.\nПроверено: ${checked}\nУдалено ключей: ${deleted}\nПропущено: ${skipped}`);
    await ctx.reply('Меню обновления:', kbUpdateMenu());
  });

  bot.hears('🔁 Обновить все', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices_menu') return next();

    await ctx.reply('Начинаю обновление цен во всех постах...\nЭто может занять некоторое время.');

    const keys = await getAllCatalogPostKeys();
    if (!Array.isArray(keys) || keys.length === 0) {
      await ctx.reply('Нет сохранённых постов для обновления.');
      return;
    }

    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    const changedRows = [];
    const sameRows = [];
    const failRows = [];

    for (const key of keys) {
      const messageIdStr = String(key).replace(/^catalogpost:/, '');
      const messageId = Number(messageIdStr);
      if (!Number.isFinite(messageId)) {
        failRows.push({ messageId: messageIdStr, reason: 'Некорректный ключ' });
        continue;
      }

      try {
        const meta = await getCatalogPostMetaByKey(key);
        if (!meta?.selected) {
          failRows.push({ messageId, reason: 'Нет метаданных selected (пост не из /post?)' });
          continue;
        }

        const targetChatId = meta.channelChatId;
        if (!targetChatId) {
          failRows.push({
            messageId,
            reason:
              'Нет channelChatId в метаданных. Откройте пост через «🧾 Обновить по пересланному посту» и нажмите «🚀 Опубликовать».',
          });
          continue;
        }

        const kind = meta.kind || 'photo';
        const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
        const baseText = normStr(meta.baseTextNoHint);
        const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

        const { changed } = await editPostTextOrCaption(ctx, { chatId: targetChatId, messageId }, newCaption, kind);

        await setCatalogPostMetaByKey(key, {
          ...meta,
          last_total_price: total,
          updatedAt: Date.now(),
          channelChatId: targetChatId,
          kind,
        });

        const row = { messageId, total, link: makeChannelPostLink(targetChatId, messageId) };
        if (changed) changedRows.push(row);
        else sameRows.push(row);
      } catch (e) {
        const desc = e?.response?.description || e?.message || String(e);
        failRows.push({ messageId, reason: desc });
      }
    }

    await ctx.reply(
      `Обновление завершено.\n\n✅ Обновлено: ${changedRows.length}\nℹ️ Без изменений: ${sameRows.length}\n❌ Ошибок: ${failRows.length}`
    );

    if (changedRows.length) {
      await ctx.reply(
        '✅ Пост обновлён:\n\n' +
          changedRows
            .slice(0, 30)
            .map((r) => `✅ ${r.messageId} → Цена: от ${formatRub(r.total)} ₽\n${r.link}`)
            .join('\n\n')
      );
    }

    if (sameRows.length) {
      await ctx.reply(
        'ℹ️ Изменений нет:\n\n' +
          sameRows
            .slice(0, 30)
            .map((r) => `ℹ️ ${r.messageId} → Цена: от ${formatRub(r.total)} ₽\n${r.link}`)
            .join('\n\n')
      );
    }

    if (failRows.length) {
      await ctx.reply(
        '❌ Ошибки:\n\n' +
          failRows
            .slice(0, 30)
            .map((r) => `❌ ${r.messageId}\nПричина: ${r.reason}`)
            .join('\n\n')
      );
    }

    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
  });

  async function openEditMenuForForwardedPost(ctx, chatId, messageId, meta) {
    const wiz = ctx.session.postWizard;

    wiz.mode = 'edit_existing';
    wiz.editTarget = { chatId, messageId };
    wiz.editMeta = meta;
    wiz.baseTextNoHint = normStr(meta.baseTextNoHint);

    wiz.selected = {
      STELA: meta.selected?.STELA ?? null,
      TUMBA: meta.selected?.TUMBA ?? null,
      CVETNIK: meta.selected?.CVETNIK ?? null,
      PLITA: meta.selected?.PLITA ?? null,
      WORK: meta.selected?.WORK ?? null,
      OPTION: Array.isArray(meta.selected?.OPTION) ? meta.selected.OPTION : [],
      GRAFIKA: Array.isArray(meta.selected?.GRAFIKA) ? meta.selected.GRAFIKA : [],
    };

    meta.channelChatId = meta.channelChatId || chatId;
    meta.kind = meta.kind || 'photo';
    await setCatalogPostMeta(messageId, meta);

    wiz.step = 'edit_menu';

    const selectedText = await describeSelected(wiz.selected);
    const link = makeChannelPostLink(chatId, messageId);

    await ctx.reply(`Текущие параметры поста:\n\n${selectedText}\n\nПост: ${link}`, editFieldMenuKb());
  }

  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    if (wiz.step === 'edit_wait_post') {
      const fwd = ctx.message?.forward_from_message_id ? ctx.message : null;

      if (!fwd || !fwd.forward_from_chat || !fwd.forward_from_message_id) {
        await ctx.reply('Пожалуйста, перешлите ОРИГИНАЛЬНЫЙ пост из канала.');
        return;
      }

      const chatId = fwd.forward_from_chat.id;
      const messageId = fwd.forward_from_message_id;

      const expectedChannelId = getChannelId();
      if (expectedChannelId && Number(expectedChannelId) !== Number(chatId)) {
        await ctx.reply('Похоже, этот пост из другого канала. Перешлите пост из нужного канала.');
        return;
      }

      const meta = await getCatalogPostMeta(messageId);
      if (!meta || !meta.selected) {
        await ctx.reply('Не нашёл данные этого поста в базе. Он должен быть создан через /post.');
        return;
      }

      await openEditMenuForForwardedPost(ctx, chatId, messageId, meta);
      return;
    }

    if (!('text' in ctx.message) || !ctx.message.text) return next();
    const text = ctx.message.text.trim();

    if (wiz.step === 'edit_menu') {
      if (text === '⬅️ Назад') {
        wiz.step = 'update_prices_menu';
        await ctx.reply('Обновление постов:', kbUpdateMenu());
        return;
      }

      if (text === '🚀 Опубликовать') {
        if (!wiz.editTarget?.chatId || !wiz.editTarget?.messageId) {
          await ctx.reply('Ошибка: не указан пост для обновления.');
          return;
        }

        const metaKind = wiz.editMeta?.kind;

        try {
          const { total, changed, kind } = await applySelectedToMessage(ctx, wiz.editTarget, wiz.baseTextNoHint, wiz.selected, metaKind);

          wiz.editMeta = wiz.editMeta || {};
          wiz.editMeta.kind = kind;
          wiz.editMeta.channelChatId = wiz.editTarget.chatId;

          await setCatalogPostMeta(wiz.editTarget.messageId, {
            ...wiz.editMeta,
            selected: wiz.selected,
            baseTextNoHint: wiz.baseTextNoHint,
          });

          wiz.step = 'update_prices_menu';
          if (changed) await ctx.reply(`✅ Пост обновлён.\nЦена: от ${formatRub(total)} ₽`, kbUpdateMenu());
          else await ctx.reply(`ℹ️ Изменений нет.\nЦена: от ${formatRub(total)} ₽`, kbUpdateMenu());
          return;
        } catch (e) {
          const desc = e?.response?.description || e?.message || String(e);
          await ctx.reply(`Не удалось обновить пост: ${desc}`);
          return;
        }
      }

      const goStep = async (step) => {
        wiz.step = step;
        return askStep(ctx, step);
      };

      if (text === '🪧 Стела') return goStep('STELA');
      if (text === '🧱 Тумба') return goStep('TUMBA');
      if (text === '🌿 Цветник') return goStep('CVETNIK');
      if (text === '🪨 Плита') return goStep('PLITA');
      if (text === '🛠 Работа') return goStep('WORK');
      if (text === '➕ Опции') return goStep('OPTION');
      if (text === '🎨 Графика') return goStep('GRAFIKA');

      return next();
    }

    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      if (text === 'Далее') {
        if (wiz.mode === 'edit_existing') {
          wiz.step = 'edit_menu';
          const selectedText = await describeSelected(wiz.selected);
          await ctx.reply(`Текущие параметры поста:\n\n${selectedText}`, editFieldMenuKb());
          return;
        }
        return advance(ctx);
      }

      if (text === 'Сбросить') {
        wiz.selected[wiz.step] = [];
        return askStep(ctx, wiz.step);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const pool = wiz.step === 'OPTION' ? items.filter(isOptionItem) : items.filter(isGrafikaItem);

      const it =
        pool.find((x) => normStr(x.label) === text) ||
        pool.find((x) => normStr(x.sku) === text) ||
        pool.find((x) => up(x.sku) === up(text));

      if (!it) return next();

      const arr = Array.isArray(wiz.selected[wiz.step]) ? wiz.selected[wiz.step] : [];
      const idx = arr.indexOf(it.sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(it.sku);
      wiz.selected[wiz.step] = arr;

      return;
    }

    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;

        if (wiz.mode === 'edit_existing') {
          wiz.step = 'edit_menu';
          const selectedText = await describeSelected(wiz.selected);
          await ctx.reply(`Текущие параметры поста:\n\n${selectedText}`, editFieldMenuKb());
          return;
        }

        return advance(ctx);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const it = items.find((x) => x.group === wiz.step && normStr(x.label) === text);
      if (!it) return next();

      wiz.selected[wiz.step] = it.sku;

      if (wiz.mode === 'edit_existing') {
        wiz.step = 'edit_menu';
        const selectedText = await describeSelected(wiz.selected);
        await ctx.reply(`Текущие параметры поста:\n\n${selectedText}`, editFieldMenuKb());
        return;
      }

      return advance(ctx);
    }

    return next();
  });
}