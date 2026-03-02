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

  const caption = `Цена: ${formatRub(total)} ₽\n${uniq.join(' ')}`.trim();
  return { total, tags: uniq, caption };
}

// --- helpers ---
const normStr = (v) => String(v || '').trim();
const up = (v) => normStr(v).toUpperCase();

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
  } = deps;

  const stepsOrder = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'OPTION', 'GRAFIKA', 'PREVIEW'];

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

  const kbPostMenu = () =>
    Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();

  // ---------- /post старт ----------
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
      mode: 'new', // new | edit_existing
      editTarget: null, // { chatId, messageId }
      baseTextNoHint,
      mediaPayload,
      selected: {
        STELA: null,
        TUMBA: null,
        CVETNIK: null,
        PLITA: null,
        WORK: null,
        OPTION: [],
        GRAFIKA: [],
      },
    };

    return ctx.reply('Меню /post:', kbPostMenu());
  });

  // ---------- Меню мастера ----------
  bot.hears('▶️ Новая публикация', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();

    ctx.session.postWizard.mode = 'new';
    ctx.session.postWizard.editTarget = null;

    ctx.session.postWizard.step = 'STELA';
    return askStep(ctx, 'STELA');
  });

  bot.hears('♻️ Обновить цены', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();

    ctx.session.postWizard.step = 'update_prices_menu';
    await ctx.reply(
      'Обновление постов:\n\n1) «🧾 Обновить по пересланному посту» — перешлите пост из канала. Можно отредактировать параметры (стела/тумба/цветник/плита/работа/опции/графика) и обновить пост.\n\n2) «🔁 Обновить все» — пересчитать цены во всех постах, созданных через /post (параметры не меняются).',
      Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard) return next();

    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('Отменить', async (ctx, next) => {
    if (!ctx.session?.postWizard) return next();
    ctx.session.postWizard = null;
    await ctx.reply('Отменено.', Markup.removeKeyboard());
  });

  // ---------- Локальные функции мастера ----------
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
    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = normStr(wiz.baseTextNoHint);
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    wiz.step = 'CONFIRM';
    wiz._previewTotal = total;

    const confirmText =
      wiz.mode === 'edit_existing'
        ? 'Предпросмотр обновления:\n\n' + fullCaption + '\n\nЕсли всё верно — нажмите «Обновить пост».'
        : 'Предпросмотр:\n\n' + fullCaption + '\n\nЕсли всё верно — нажмите «Опубликовать».';

    const btn = wiz.mode === 'edit_existing' ? 'Обновить пост' : 'Опубликовать';

    await ctx.reply(confirmText, Markup.keyboard([[btn], ['Отменить']]).resize());
  }

  // --------- пересчитать/обновить подпись поста (только цена) ---------
  async function recalcPriceForMessage(ctx, chatId, messageId, catalog, metaFromStore) {
    const meta = metaFromStore || (await getCatalogPostMeta(messageId));
    if (!meta) {
      throw new Error(`Нет метаданных для поста message_id=${messageId}`);
    }

    const { selected, baseTextNoHint } = meta;

    const { caption, total } = calcCaptionAndTags(catalog, selected);
    const baseText = normStr(baseTextNoHint);
    const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(
      0,
      1024
    );

    try {
      await ctx.telegram.editMessageCaption(chatId, messageId, undefined, newCaption);
    } catch (e) {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, newCaption, {
        disable_web_page_preview: true,
      });
    }

    await setCatalogPostMeta(messageId, { ...meta, last_total_price: total, updatedAt: Date.now() });
    return total;
  }

  // --------- ВАЖНО: обновить параметры + пересчитать + обновить пост ---------
  async function applyEditsToExistingPost(ctx, { chatId, messageId }, baseTextNoHint, selected) {
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { caption, total } = calcCaptionAndTags(catalog, selected);

    const baseText = normStr(baseTextNoHint);
    const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(
      0,
      1024
    );

    try {
      await ctx.telegram.editMessageCaption(chatId, messageId, undefined, newCaption);
    } catch (e) {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, newCaption, {
        disable_web_page_preview: true,
      });
    }

    await setCatalogPostMeta(messageId, {
      selected,
      baseTextNoHint: baseText,
      last_total_price: total,
      updatedAt: Date.now(),
    });

    return total;
  }

  // обработчик "🧾 Обновить по пересланному посту"
  bot.hears('🧾 Обновить по пересланному посту', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices_menu') return next();

    await ctx.reply(
      'Перешлите сюда пост из канала, который нужно изменить (параметры/состав/цена).',
      Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize()
    );

    ctx.session.postWizard.step = 'edit_wait_post';
  });

    // обработчик "🔁 Обновить все" (подробный отчёт)
  bot.hears('🔁 Обновить все', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (ctx.session?.order) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices_menu') return next();

    const channelId = getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');

    await ctx.reply('Начинаю обновление цен во всех постах...\nЭто может занять некоторое время.');

    const keys = await getAllCatalogPostKeys();
    console.log('[postWizard] update-all keys count =', keys.length);

    if (!keys.length) {
      await ctx.reply('Нет сохранённых постов для обновления.');
      return;
    }

    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    const okRows = [];
    const failRows = [];

    for (const key of keys) {
      const messageIdStr = String(key).replace(/^catalogpost:/, '');
      const messageId = Number(messageIdStr);

      if (!Number.isFinite(messageId)) {
        failRows.push({
          key,
          messageId: messageIdStr,
          reason: `Некорректный ключ (не число): ${messageIdStr}`,
        });
        continue;
      }

      try {
        const meta = await getCatalogPostMetaByKey(key);
        if (!meta) {
          failRows.push({
            key,
            messageId,
            reason: 'Нет метаданных (meta=null) для этого поста',
          });
          continue;
        }

        const total = await recalcPriceForMessage(ctx, channelId, messageId, catalog, meta);

        // ссылка на пост
        const link =
          typeof channelId === 'string' && channelId.startsWith('@')
            ? `https://t.me/${channelId.replace('@', '')}/${messageId}`
            : null;

        okRows.push({
          messageId,
          total,
          link,
        });
      } catch (e) {
        const desc = e?.response?.description || e?.message || String(e);
        failRows.push({
          key,
          messageId,
          reason: desc,
        });
      }
    }

    // helper: форматирование отчёта в несколько сообщений (лимит телеграма ~4096)
    const chunks = [];
    const pushChunk = (text) => {
      if (!text) return;
      chunks.push(text);
    };

    const header = `Обновление завершено.\n\nУспешно: ${okRows.length}\nОшибок: ${failRows.length}`;
    pushChunk(header);

    if (okRows.length) {
      const lines = okRows.map((r) => {
        const price = formatRub(r.total);
        const base = `✅ message_id: ${r.messageId} → ${price} ₽`;
        return r.link ? `${base}\n${r.link}` : base;
      });

      let cur = '---\n✅ Успешно обновлены:\n';
      for (const l of lines) {
        if ((cur + '\n' + l).length > 3500) {
          pushChunk(cur);
          cur = '✅ Успешно обновлены (продолжение):\n';
        }
        cur += l + '\n';
      }
      pushChunk(cur.trim());
    }

    if (failRows.length) {
      const lines = failRows.map((r) => `❌ message_id: ${r.messageId}\nПричина: ${r.reason}`);

      let cur = '---\n❌ Ошибки:\n';
      for (const l of lines) {
        if ((cur + '\n' + l).length > 3500) {
          pushChunk(cur);
          cur = '❌ Ошибки (продолжение):\n';
        }
        cur += l + '\n\n';
      }
      pushChunk(cur.trim());
    }

    for (const msg of chunks) {
      await ctx.reply(msg);
    }

    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
  });

  // ---------- ОБРАБОТЧИК СООБЩЕНИЙ МАСТЕРА /POST ----------
  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    // --- режим: ждём пересланный пост, чтобы редактировать параметры ---
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

      // стартуем визард как "редактирование", подставляя старые выбранные параметры
      wiz.mode = 'edit_existing';
      wiz.editTarget = { chatId, messageId };
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

      wiz.step = 'STELA';

      await ctx.reply(
        'Редактирование поста запущено.\nМожно изменить один или несколько параметров, а затем нажать «Обновить пост».',
        Markup.removeKeyboard()
      );

      return askStep(ctx, 'STELA');
    }

    // ниже — стандартная логика визарда (как у вас), но CONFIRM учитывает режим edit_existing
    if (!('text' in ctx.message) || !ctx.message.text) return next();
    const text = ctx.message.text.trim();

    // CONFIRM
    if (wiz.step === 'CONFIRM') {
      const isEdit = wiz.mode === 'edit_existing';
      const needText = isEdit ? 'Обновить пост' : 'Опубликовать';
      if (text !== needText) return next();

      if (isEdit) {
        if (!wiz.editTarget?.chatId || !wiz.editTarget?.messageId) {
          await ctx.reply('Ошибка: не указан пост для обновления.');
          return;
        }

        try {
          const total = await applyEditsToExistingPost(
            ctx,
            wiz.editTarget,
            wiz.baseTextNoHint,
            wiz.selected
          );

          ctx.session.postWizard = null;
          await ctx.reply(`Пост обновлён.\nНовая цена: ${formatRub(total)} ₽`, Markup.removeKeyboard());
          return;
        } catch (e) {
          const desc = e?.response?.description || e?.message || String(e);
          await ctx.reply(`Не удалось обновить пост: ${desc}`);
          return;
        }
      }

      // обычная публикация нового поста (ваш код)
      const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

      const baseText = normStr(wiz.baseTextNoHint);
      const finalCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(
        0,
        1024
      );

      const payload = wiz.mediaPayload || { kind: 'text' };
      const kind = payload.kind;

      let primary;
      if (kind === 'photo') {
        ({ primary } = await postToChannelWithKb(ctx, 'photo', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else if (kind === 'video') {
        ({ primary } = await postToChannelWithKb(ctx, 'video', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else if (kind === 'document') {
        ({ primary } = await postToChannelWithKb(ctx, 'document', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else {
        ({ primary } = await postToChannelWithKb(ctx, 'text', { text: finalCaption }, baseText));
      }

      await setCatalogPostMeta(primary.message_id, {
        selected: wiz.selected,
        baseTextNoHint: baseText,
        last_total_price: total,
        createdAt: Date.now(),
      });

      ctx.session.postWizard = null;
      await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
      return;
    }

    // OPTION / GRAFIKA (мультивыбор)
    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      if (text === 'Далее') return advance(ctx);
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

    // одиночные группы STELA/TUMBA/...
    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;
        return advance(ctx);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const it = items.find((x) => x.group === wiz.step && normStr(x.label) === text);
      if (!it) return next();

      wiz.selected[wiz.step] = it.sku;
      return advance(ctx);
    }

    return next();
  });
}